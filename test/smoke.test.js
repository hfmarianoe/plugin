const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const root = path.join(__dirname, '..');
const smoke = path.join(root, 'scripts', 'smoke.js');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function runSmoke(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [smoke, ...args], { timeout: 60000 }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

let server;
let port;

test.before(async () => {
  port = await freePort();
  server = spawn(process.execPath, [path.join(root, 'e2e', 'server.js')], { env: { ...process.env, PORT: String(port) } });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('E2E server on') && resolve());
    server.on('error', reject);
    server.on('exit', (c) => reject(new Error(`el servidor de pruebas terminó con código ${c}`)));
  });
});

test.after(() => server.kill());

test('contra el sitio local en modo memoria pasan las 7 comprobaciones', async () => {
  const r = await runSmoke([`http://127.0.0.1:${port}`, '--expect-mode', 'memory', '--retries', '0']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /7\/7 comprobaciones correctas/);
  assert.ok(!r.stdout.includes('❌'));
});

test('no deja notas reales: el sitio sigue sin notas tras la prueba', async () => {
  await runSmoke([`http://127.0.0.1:${port}`, '--expect-mode', 'memory', '--retries', '0']);
  const { notes } = await (await fetch(`http://127.0.0.1:${port}/api/notes`)).json();
  assert.deepStrictEqual(notes, []);
});

test('si el modo esperado no coincide falla e indica el modo real', async () => {
  const r = await runSmoke([`http://127.0.0.1:${port}`, '--expect-mode', 'supabase', '--retries', '0']);
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /modo "memory" en vez de "supabase"/);
  assert.match(r.stdout, /6\/7 comprobaciones correctas/);
});

test('si el sitio no responde falla con un mensaje claro', async () => {
  const closed = await freePort();
  const r = await runSmoke([`http://127.0.0.1:${closed}`, '--retries', '0', '--timeout', '2000']);
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /No se pudo conectar/);
});

test('argumentos inválidos terminan con código 2', async () => {
  for (const args of [[], ['ftp://x'], ['http://x', '--expect-mode', 'otro'], ['http://x', '--nope']]) {
    const r = await runSmoke(args);
    assert.strictEqual(r.code, 2, args.join(' '));
  }
});
