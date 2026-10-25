const test = require('node:test');
const assert = require('node:assert');
const { loadHandler, makeCall, withSilencedErrors } = require('../testing/call');

test('en producción sin base de datos configurada GET y POST responden 500 genérico', async () => {
  const call = makeCall(loadHandler({ VERCEL_ENV: 'production' }));
  for (const req of [{ method: 'GET' }, { method: 'POST', body: { body: 'x' } }]) {
    const { result, logged } = await withSilencedErrors(() => call(req));
    assert.strictEqual(result.code, 500, req.method);
    assert.strictEqual(result.body.error, 'Error interno del servidor');
    assert.strictEqual(logged.length, 1);
  }
});

test('en preview sin base de datos sigue funcionando en modo memoria', async () => {
  const call = makeCall(loadHandler({ VERCEL_ENV: 'preview' }));
  const r = await call({ method: 'GET' });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.mode, 'memory');
});

test('en producción con base de datos configurada responde con normalidad', async () => {
  const call = makeCall(loadHandler({ VERCEL_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k' }));
  global.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
  const r = await call({ method: 'GET' });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.mode, 'supabase');
});
