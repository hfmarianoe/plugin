#!/usr/bin/env node
// Smoke test against a deployed site. It never creates real notes: the only POSTs are rejected
// requests (415, 400) and a honeypot request, which the API discards without saving.
//
// Usage: node scripts/smoke.js <url> [--expect-mode supabase|memory] [--timeout ms] [--retries n]
const { randomBytes } = require('node:crypto');

class Retryable extends Error {}

function parseArgs(argv) {
  const opts = { url: null, expectMode: 'supabase', timeout: 10000, retries: 2 };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--expect-mode') opts.expectMode = args[++i];
    else if (arg === '--timeout') opts.timeout = Number(args[++i]);
    else if (arg === '--retries') opts.retries = Number(args[++i]);
    else if (arg.startsWith('--')) throw new Error(`Opción desconocida: ${arg}`);
    else opts.url = arg;
  }
  if (!opts.url) throw new Error('Uso: node scripts/smoke.js <url> [--expect-mode supabase|memory] [--timeout ms] [--retries n]');
  if (!['supabase', 'memory'].includes(opts.expectMode)) throw new Error('--expect-mode debe ser supabase o memory');
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) throw new Error('--timeout debe ser un número positivo');
  if (!Number.isInteger(opts.retries) || opts.retries < 0) throw new Error('--retries debe ser un entero >= 0');
  const url = new URL(opts.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('La URL debe ser http o https');
  opts.base = url.origin;
  return opts;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeClient({ base, timeout }) {
  // Returns { res, text, ms }. Network errors, timeouts and 502/503/504 are retryable.
  return async function request(path, options = {}) {
    const started = Date.now();
    let res;
    try {
      res = await fetch(base + path, { redirect: 'manual', ...options, signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      throw new Retryable(`No se pudo conectar con ${base}${path}: ${err.cause?.code || err.cause?.message || err.message || err.name}`);
    }
    const text = await res.text();
    const ms = Date.now() - started;
    if ([502, 503, 504].includes(res.status)) throw new Retryable(`${path} respondió ${res.status}`);
    if (res.status === 401 || (res.status === 403 && /vercel/i.test(`${text} ${res.headers.get('server')}`))) {
      throw new Error(`${path} respondió ${res.status}: el sitio parece protegido (Vercel Authentication). Usa la URL pública de producción`);
    }
    return { res, text, ms };
  };
}

function buildChecks({ expectMode }, request) {
  const jsonPost = (payload) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const parse = (text, what) => {
    try { return JSON.parse(text); } catch { throw new Error(`${what} no devolvió JSON válido: ${text.slice(0, 80)}`); }
  };

  return [
    ['La página principal carga', async () => {
      const { res, text } = await request('/');
      assert(res.status === 200, `GET / respondió ${res.status}`);
      assert(/text\/html/.test(res.headers.get('content-type') || ''), 'GET / no devolvió HTML');
      assert(text.includes('<title>Muro de notas</title>'), 'GET / no contiene el título esperado');
      assert(text.includes('name="hp_check"') && text.includes('<label for="body">'), 'GET / no parece la versión actual de la página');
    }],

    [`La API lee notas en modo ${expectMode}`, async () => {
      const { res, text } = await request('/api/notes');
      assert(res.status === 200, `GET /api/notes respondió ${res.status}`);
      const data = parse(text, 'GET /api/notes');
      assert(data.mode === expectMode, `modo "${data.mode}" en vez de "${expectMode}" (¿faltan variables de entorno?)`);
      assert(Array.isArray(data.notes), 'notes no es una lista');
      for (const n of data.notes) {
        assert(['id', 'author', 'body', 'created_at'].every((k) => k in n), 'una nota no tiene los campos id, author, body y created_at');
      }
      const dates = data.notes.map((n) => Date.parse(n.created_at));
      assert(dates.every((d, i) => i === 0 || dates[i - 1] >= d), 'las notas no vienen de la más nueva a la más antigua');
    }],

    ['La API responde en menos de 3 s', async () => {
      const { ms } = await request('/api/notes');
      assert(ms < 3000, `GET /api/notes tardó ${ms} ms`);
    }],

    ['Rechaza un POST que no es JSON (415)', async () => {
      const { res } = await request('/api/notes', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hola' });
      assert(res.status === 415, `respondió ${res.status} en vez de 415`);
    }],

    ['Rechaza una nota vacía (400)', async () => {
      const { res, text } = await request('/api/notes', jsonPost({ body: '   ' }));
      assert(res.status === 400, `respondió ${res.status} en vez de 400`);
      assert(/vac/i.test(parse(text, 'POST vacío').error || ''), 'el mensaje de error no menciona que está vacía');
    }],

    ['Descarta a los bots (honeypot) sin guardar nada', async () => {
      const marker = `smoke-${randomBytes(6).toString('hex')}`;
      const { res, text } = await request('/api/notes', jsonPost({ body: marker, hp_check: 'http://spam.example' }));
      assert(res.status === 201, `respondió ${res.status} en vez de 201`);
      assert(parse(text, 'POST honeypot').ok === true, 'no devolvió { ok: true }');
      const list = await request('/api/notes');
      assert(!list.text.includes(marker), 'la nota del bot quedó guardada');
    }],

    ['Rechaza métodos no soportados (405)', async () => {
      const { res } = await request('/api/notes', { method: 'DELETE' });
      assert(res.status === 405, `respondió ${res.status} en vez de 405`);
      assert(res.headers.get('allow') === 'GET, POST', `cabecera Allow: ${res.headers.get('allow')}`);
    }],
  ];
}

async function runCheck(run, retries) {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      await run();
      return { ok: true, ms: Date.now() - started };
    } catch (err) {
      if (err instanceof Retryable && attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return { ok: false, ms: Date.now() - started, error: err.message };
    }
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  console.log(`Prueba de humo: ${opts.base} (modo esperado: ${opts.expectMode})\n`);
  const request = makeClient(opts);
  const checks = buildChecks(opts, request);
  let failed = 0;
  for (const [name, run] of checks) {
    const result = await runCheck(run, opts.retries);
    if (result.ok) {
      console.log(`  ✅ ${name} (${result.ms} ms)`);
    } else {
      failed++;
      console.log(`  ❌ ${name}\n       ${result.error}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} comprobaciones correctas`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { parseArgs };
