const test = require('node:test');
const assert = require('node:assert');
const { loadHandler, makeCall, withSilencedErrors } = require('../testing/call');

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: 'clave-de-prueba' };
const call = makeCall(loadHandler(ENV));

const json = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });

// Replaces global fetch and records every request.
function mockFetch(responder) {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return responder(url, options);
  };
  return calls;
}

test('GET lee de Supabase con la clave, orden y límite correctos', async () => {
  const rows = [{ id: 2, author: 'Ana', body: 'b', created_at: '2026-01-02T00:00:00Z' }];
  const calls = mockFetch(() => json(200, rows));
  const r = await call({ method: 'GET' });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.mode, 'supabase');
  assert.deepStrictEqual(r.body.notes, rows);

  const [{ url, options }] = calls;
  assert.match(url, /^https:\/\/example\.supabase\.co\/rest\/v1\/notes\?/);
  assert.match(url, /order=created_at\.desc/);
  assert.match(url, /limit=50/);
  assert.strictEqual(options.headers.apikey, 'clave-de-prueba');
  assert.strictEqual(options.headers.Authorization, 'Bearer clave-de-prueba');
  assert.strictEqual(options.headers.Prefer, undefined, 'Prefer solo se envía en POST');
});

test('POST envía solo author y body, con Prefer, y devuelve la fila creada', async () => {
  const created = { id: 7, author: 'Ana', body: 'hola', created_at: '2026-01-01T00:00:00Z' };
  const calls = mockFetch(() => json(201, [created]));
  const r = await call({
    method: 'POST',
    body: { author: ' Ana ', body: ' hola ', id: 999, created_at: '1999-01-01', hp_check: '' },
  });
  assert.strictEqual(r.code, 201);
  assert.deepStrictEqual(r.body, created);

  const [{ options }] = calls;
  assert.strictEqual(options.method, 'POST');
  assert.strictEqual(options.headers.Prefer, 'return=representation');
  assert.deepStrictEqual(JSON.parse(options.body), { author: 'Ana', body: 'hola' }, 'no debe pasar campos extra');
});

test('cada llamada a Supabase lleva una señal de timeout sin disparar', async () => {
  const calls = mockFetch(() => json(200, []));
  await call({ method: 'GET' });
  const { signal } = calls[0].options;
  assert.ok(signal instanceof AbortSignal);
  assert.strictEqual(signal.aborted, false);
});

test('si Supabase excede el timeout el API responde 500 genérico', async () => {
  mockFetch(() => { throw new DOMException('The operation timed out', 'TimeoutError'); });
  const { result, logged } = await withSilencedErrors(() => call({ method: 'GET' }));
  assert.strictEqual(result.code, 500);
  assert.strictEqual(result.body.error, 'Error interno del servidor');
  assert.strictEqual(logged.length, 1, 'el detalle se registra en el servidor');
});

test('errores de Supabase (GET y POST, 401/500) no filtran detalles al cliente', async () => {
  for (const status of [401, 500, 503]) {
    mockFetch(() => ({ ok: false, status, text: async () => 'tabla notes, política notes_insert, secreto-interno' }));
    for (const req of [{ method: 'GET' }, { method: 'POST', body: { body: 'x' } }]) {
      const { result } = await withSilencedErrors(() => call(req));
      assert.strictEqual(result.code, 500, `${req.method} ${status}`);
      assert.ok(!JSON.stringify(result.body).includes('secreto-interno'));
    }
  }
});

test('429 de Supabase se traduce a 429 con mensaje amigable en POST', async () => {
  mockFetch(() => ({ ok: false, status: 429, text: async () => 'PT429' }));
  const r = await call({ method: 'POST', body: { body: 'x' } });
  assert.strictEqual(r.code, 429);
  assert.match(r.body.error, /Demasiadas notas/);
});

test('honeypot lleno no llega a Supabase', async () => {
  const calls = mockFetch(() => json(201, [{}]));
  const r = await call({ method: 'POST', body: { body: 'spam', hp_check: 'x' } });
  assert.strictEqual(r.code, 201);
  assert.strictEqual(calls.length, 0);
});

test('una validación fallida no llega a Supabase', async () => {
  const calls = mockFetch(() => json(201, [{}]));
  for (const body of [{ body: '  ' }, { body: { x: 1 } }, null]) {
    const r = await call({ method: 'POST', body });
    assert.strictEqual(r.code, 400);
  }
  assert.strictEqual(calls.length, 0);
});

test('con SUPABASE_SERVICE_ROLE_KEY y sin SUPABASE_KEY también usa la base', async () => {
  const handler = makeCall(loadHandler({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'service' }));
  const calls = mockFetch(() => json(200, []));
  const r = await handler({ method: 'GET' });
  assert.strictEqual(r.body.mode, 'supabase');
  assert.strictEqual(calls[0].options.headers.apikey, 'service');
});
