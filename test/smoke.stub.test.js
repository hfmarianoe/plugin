// The smoke script against deliberately faulty responses: a proxy in front of the real local server
// that overrides selected requests.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const root = path.join(__dirname, '..');
const smoke = path.join(root, 'scripts', 'smoke.js');

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

const runSmoke = (args) => new Promise((resolve) => {
  execFile(process.execPath, [smoke, ...args], { timeout: 60000 }, (error, stdout) => resolve({ code: error ? error.code : 0, stdout }));
});

const sendJson = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

let backend;
let backendPort;
let proxy;
let proxyPort;
let override = () => false; // (req, res) => true when the request was handled

test.before(async () => {
  backendPort = await freePort();
  backend = spawn(process.execPath, [path.join(root, 'e2e', 'server.js')], { env: { ...process.env, PORT: String(backendPort) } });
  await new Promise((resolve, reject) => {
    backend.stdout.on('data', (d) => String(d).includes('E2E server on') && resolve());
    backend.on('error', reject);
  });

  proxy = http.createServer(async (req, res) => {
    if (override(req, res)) return;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const upstream = await fetch(`http://127.0.0.1:${backendPort}${req.url}`, {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] || 'text/plain' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const headers = {};
    for (const h of ['content-type', 'allow']) if (upstream.headers.get(h)) headers[h] = upstream.headers.get(h);
    res.writeHead(upstream.status, headers);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  proxyPort = proxy.address().port;
});

test.after(() => { backend.kill(); proxy.close(); });
test.beforeEach(() => { override = () => false; });

const url = () => `http://127.0.0.1:${proxyPort}`;
const base = (extra = []) => [url(), '--expect-mode', 'memory', '--retries', '0', ...extra];
const isList = (req) => req.method === 'GET' && req.url === '/api/notes';

test('el proxy sin fallos deja pasar las 7 comprobaciones', async () => {
  const r = await runSmoke(base());
  assert.strictEqual(r.code, 0, r.stdout);
  assert.match(r.stdout, /7\/7/);
});

test('detecta notas ordenadas de la más antigua a la más nueva', async () => {
  override = (req, res) => isList(req) && (sendJson(res, 200, { mode: 'memory', notes: [
    { id: 1, author: 'a', body: 'vieja', created_at: '2026-01-01T00:00:00Z' },
    { id: 2, author: 'b', body: 'nueva', created_at: '2026-01-02T00:00:00Z' },
  ] }), true);
  const r = await runSmoke(base());
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /no vienen de la más nueva a la más antigua/);
});

test('acepta notas correctamente ordenadas', async () => {
  override = (req, res) => isList(req) && (sendJson(res, 200, { mode: 'memory', notes: [
    { id: 2, author: 'b', body: 'nueva', created_at: '2026-01-02T00:00:00Z' },
    { id: 1, author: 'a', body: 'vieja', created_at: '2026-01-01T00:00:00Z' },
  ] }), true);
  const r = await runSmoke(base());
  assert.strictEqual(r.code, 0, r.stdout);
});

test('detecta una nota sin alguno de los campos', async () => {
  override = (req, res) => isList(req) && (sendJson(res, 200, { mode: 'memory', notes: [{ id: 1, author: 'a', body: 'x' }] }), true);
  const r = await runSmoke(base());
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /no tiene los campos id, author, body y created_at/);
});

test('detecta que la API no devuelve JSON', async () => {
  override = (req, res) => isList(req) && (res.writeHead(200, { 'Content-Type': 'text/html' }), res.end('<html>error</html>'), true);
  const r = await runSmoke(base());
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /no devolvió JSON válido/);
});

test('un 401 se explica como protección de Vercel', async () => {
  override = (req, res) => (res.writeHead(401, { 'Content-Type': 'text/html' }), res.end('Authentication Required'), true);
  const r = await runSmoke(base());
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /protegido \(Vercel Authentication\)/);
});

test('un 503 transitorio se reintenta y luego pasa', async () => {
  let first = true;
  override = (req, res) => {
    if (req.url === '/' && first) { first = false; res.writeHead(503); res.end('Service Unavailable'); return true; }
    return false;
  };
  const r = await runSmoke(base(['--retries', '1']));
  assert.strictEqual(r.code, 0, r.stdout);
});

test('un 503 persistente falla aun con reintentos', async () => {
  override = (req, res) => req.url === '/' && (res.writeHead(503), res.end('x'), true);
  const r = await runSmoke(base(['--retries', '1']));
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /respondió 503/);
});

test('detecta una página principal desactualizada', async () => {
  override = (req, res) => req.url === '/' && (res.writeHead(200, { 'Content-Type': 'text/html' }), res.end('<title>Muro de notas</title>'), true);
  const r = await runSmoke(base());
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /no parece la versión actual/);
});
