const test = require('node:test');
const assert = require('node:assert');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.VERCEL_ENV;
const handler = require('../api/notes.js');

function call(req) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      status(code) { res.code = code; return res; },
      setHeader(k, v) { headers[k] = v; },
      json(body) { resolve({ code: res.code, body, headers }); return res; },
    };
    handler({ headers: { 'content-type': 'application/json' }, ...req }, res);
  });
}

test('POST crea una nota y GET la lista', async () => {
  const post = await call({ method: 'POST', body: { author: 'Ana', body: 'hola' } });
  assert.strictEqual(post.code, 201);
  const get = await call({ method: 'GET' });
  assert.strictEqual(get.code, 200);
  assert.strictEqual(get.body.mode, 'memory');
  assert.strictEqual(get.body.notes[0].body, 'hola');
});

test('nota vacía devuelve 400', async () => {
  const r = await call({ method: 'POST', body: { body: '   ' } });
  assert.strictEqual(r.code, 400);
});

test('JSON inválido devuelve 400', async () => {
  const r = await call({ method: 'POST', body: '{no es json' });
  assert.strictEqual(r.code, 400);
});

test('campos que no son texto devuelven 400', async () => {
  const r = await call({ method: 'POST', body: { author: { x: 1 }, body: 'hola' } });
  assert.strictEqual(r.code, 400);
});

test('sin application/json devuelve 415', async () => {
  const r = await call({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.strictEqual(r.code, 415);
});

test('no parte emojis al recortar a 280', async () => {
  const r = await call({ method: 'POST', body: { body: '😀'.repeat(300) } });
  assert.strictEqual(r.code, 201);
  assert.strictEqual(Array.from(r.body.body).length, 280);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(r.body.body));
});

test('método no permitido devuelve 405 con Allow', async () => {
  const r = await call({ method: 'DELETE' });
  assert.strictEqual(r.code, 405);
  assert.strictEqual(r.headers.Allow, 'GET, POST');
});

test('honeypot lleno responde 201 sin guardar la nota', async () => {
  const antes = (await call({ method: 'GET' })).body.notes.length;
  const r = await call({ method: 'POST', body: { body: 'spam', hp_check: 'http://spam' } });
  assert.strictEqual(r.code, 201);
  const despues = (await call({ method: 'GET' })).body.notes.length;
  assert.strictEqual(despues, antes);
});
