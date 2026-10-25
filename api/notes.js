// Serverless function (Vercel). Uses Supabase REST when configured, otherwise in-memory (demo mode).
const { SUPABASE_URL } = process.env;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const useDb = Boolean(SUPABASE_URL && SUPABASE_KEY);
const isProduction = process.env.VERCEL_ENV === 'production';

const MAX_MEMORY_NOTES = 200;
const memory = [];
let nextId = 1;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    signal: AbortSignal.timeout(5000),
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = new Error(`Supabase ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// Trims and cuts by code points so an emoji is never split in half.
function clean(value, max, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new HttpError(400, 'Los campos deben ser texto');
  return Array.from(value.trim()).slice(0, max).join('') || fallback;
}

function parseBody(req) {
  if (!String(req.headers?.['content-type'] || '').includes('application/json')) {
    throw new HttpError(415, 'Content-Type debe ser application/json');
  }
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      throw new HttpError(400, 'JSON inválido');
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Cuerpo inválido');
  }
  return body;
}

module.exports = async (req, res) => {
  try {
    if (isProduction && !useDb) throw new Error('Base de datos no configurada');

    if (req.method === 'GET') {
      const notes = useDb
        ? await sb('notes?select=id,author,body,created_at&order=created_at.desc&limit=50')
        : memory.slice().reverse();
      return res.status(200).json({ mode: useDb ? 'supabase' : 'memory', notes });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      // Honeypot: real users never see this field, so a filled value means a bot. Pretend success.
      if (typeof body.hp_check === 'string' && body.hp_check.trim()) return res.status(201).json({ ok: true });
      const author = clean(body.author, 40, 'anónimo');
      const text = clean(body.body, 280);
      if (!text) throw new HttpError(400, 'La nota no puede estar vacía');

      if (useDb) {
        try {
          const [row] = await sb('notes', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ author, body: text }),
          });
          return res.status(201).json(row);
        } catch (err) {
          // The notes_rate_limit trigger in Postgres rejects floods with HTTP 429.
          if (err.status === 429) throw new HttpError(429, 'Demasiadas notas, intenta de nuevo en un minuto');
          throw err;
        }
      }
      const row = { id: nextId++, author, body: text, created_at: new Date().toISOString() };
      memory.push(row);
      if (memory.length > MAX_MEMORY_NOTES) memory.shift();
      return res.status(201).json(row);
    }

    res.setHeader('Allow', 'GET, POST');
    throw new HttpError(405, 'Método no permitido');
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};
