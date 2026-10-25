const test = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_KEY = 'test-key';
delete process.env.VERCEL_ENV;
const handler = require('../api/notes.js');

function call(req) {
  return new Promise((resolve) => {
    const res = {
      status(code) { res.code = code; return res; },
      setHeader() {},
      json(body) { resolve({ code: res.code, body }); return res; },
    };
    handler({ headers: { 'content-type': 'application/json' }, ...req }, res);
  });
}

test('si Postgres responde 429 (trigger) el API responde 429', async () => {
  global.fetch = async () => ({ ok: false, status: 429, text: async () => '{"message":"limit"}' });
  const r = await call({ method: 'POST', body: { body: 'hola' } });
  assert.strictEqual(r.code, 429);
  assert.match(r.body.error, /Demasiadas notas/);
});

test('otros errores de Supabase siguen siendo 500 genérico', async () => {
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'secreto interno' });
  const orig = console.error; console.error = () => {};
  const r = await call({ method: 'POST', body: { body: 'hola' } });
  console.error = orig;
  assert.strictEqual(r.code, 500);
  assert.ok(!JSON.stringify(r.body).includes('secreto'));
});
