// Local server for E2E tests: serves public/ and runs the real api/notes.js handler (in-memory mode).
// It mimics what Vercel does: parses JSON bodies and adds res.status().json().
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

for (const key of ['SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL_ENV']) delete process.env[key];
const handler = require('../api/notes.js');

const publicDir = path.join(__dirname, '..', 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/notes') {
    const raw = await readBody(req);
    if (raw && String(req.headers['content-type'] || '').includes('application/json')) {
      try { req.body = JSON.parse(raw); } catch { res.statusCode = 400; return res.end('Invalid JSON'); }
    } else {
      req.body = raw || undefined;
    }
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return res; };
    return handler(req, res);
  }

  const file = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT) || 3100;
server.listen(port, '127.0.0.1', () => console.log(`E2E server on http://127.0.0.1:${port}`));
