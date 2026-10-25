const test = require('node:test');
const assert = require('node:assert');
const { loadHandler, makeCall } = require('../testing/call');

const call = makeCall(loadHandler());

const post = (body, extra = {}) => call({ method: 'POST', body, ...extra });
const list = async () => (await call({ method: 'GET' })).body.notes;

test('cuerpos que no son un objeto devuelven 400 "Cuerpo inválido"', async () => {
  for (const body of [[], null, undefined, 5, '[]', 'null', '5']) {
    const r = await post(body);
    assert.strictEqual(r.code, 400, `cuerpo ${JSON.stringify(body)}`);
    assert.strictEqual(r.body.error, 'Cuerpo inválido');
  }
});

test('un string JSON válido se acepta como cuerpo', async () => {
  const r = await post(JSON.stringify({ author: 'Ana', body: 'desde string' }));
  assert.strictEqual(r.code, 201);
  assert.strictEqual(r.body.author, 'Ana');
});

test('autor vacío, ausente o solo espacios se guarda como "anónimo"', async () => {
  for (const author of [undefined, null, '', '   ']) {
    const r = await post({ author, body: 'sin autor' });
    assert.strictEqual(r.code, 201);
    assert.strictEqual(r.body.author, 'anónimo');
  }
});

test('el autor se recorta a 40 caracteres y la nota a 280', async () => {
  const r = await post({ author: 'a'.repeat(100), body: 'b'.repeat(500) });
  assert.strictEqual(r.body.author.length, 40);
  assert.strictEqual(r.body.body.length, 280);
});

test('honeypot con solo espacios no cuenta como bot y la nota se guarda', async () => {
  const antes = (await list()).length;
  const r = await post({ body: 'persona real', hp_check: '   ' });
  assert.strictEqual(r.code, 201);
  assert.strictEqual((await list()).length, antes + 1);
});

test('honeypot que no es texto se ignora y la nota se guarda', async () => {
  const antes = (await list()).length;
  const r = await post({ body: 'con hp numérico', hp_check: 123 });
  assert.strictEqual(r.code, 201);
  assert.strictEqual((await list()).length, antes + 1);
});

test('emojis combinados (familia, bandera) no lanzan error ni quedan cortados a la mitad', async () => {
  const familia = '👨‍👩‍👧‍👦'; // 7 code points unidos por ZWJ
  const r = await post({ body: familia.repeat(100) });
  assert.strictEqual(r.code, 201);
  assert.strictEqual(Array.from(r.body.body).length, 280);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(r.body.body), 'surrogate suelto');
});

test('content-type con charset se acepta', async () => {
  const r = await post({ body: 'charset' }, { headers: { 'content-type': 'application/json; charset=utf-8' } });
  assert.strictEqual(r.code, 201);
});

test('sin cabecera content-type devuelve 415', async () => {
  const r = await post({ body: 'x' }, { headers: {} });
  assert.strictEqual(r.code, 415);
});

test('métodos no soportados devuelven 405 con Allow', async () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const r = await call({ method });
    assert.strictEqual(r.code, 405, method);
    assert.strictEqual(r.headers.Allow, 'GET, POST');
  }
});

test('GET devuelve las notas de la más nueva a la más antigua', async () => {
  await post({ body: 'primera orden' });
  await post({ body: 'segunda orden' });
  const notas = await list();
  const i1 = notas.findIndex((n) => n.body === 'primera orden');
  const i2 = notas.findIndex((n) => n.body === 'segunda orden');
  assert.ok(i2 < i1);
});
