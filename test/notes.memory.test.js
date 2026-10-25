const test = require('node:test');
const assert = require('node:assert');
const { loadHandler, makeCall } = require('../testing/call');

test('el modo memoria conserva solo las últimas 200 notas y los id no se repiten', async () => {
  const call = makeCall(loadHandler());
  const ids = [];
  for (let i = 1; i <= 205; i++) {
    const r = await call({ method: 'POST', body: { body: `nota ${i}` } });
    assert.strictEqual(r.code, 201);
    ids.push(r.body.id);
  }
  assert.strictEqual(new Set(ids).size, 205, 'id repetidos');

  const { body } = await call({ method: 'GET' });
  assert.strictEqual(body.mode, 'memory');
  assert.strictEqual(body.notes.length, 200);
  assert.strictEqual(body.notes[0].body, 'nota 205');
  assert.strictEqual(body.notes.at(-1).body, 'nota 6');
});
