// Serverless function (Vercel). Uses Supabase REST when configured, otherwise in-memory (demo mode).
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const useDb = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const memory = [];

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const notes = useDb
        ? await sb('notes?select=id,author,body,created_at&order=created_at.desc&limit=50')
        : memory.slice().reverse();
      return res.status(200).json({ mode: useDb ? 'supabase' : 'memory', notes });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const author = String(body.author || 'anónimo').trim().slice(0, 40) || 'anónimo';
      const text = String(body.body || '').trim().slice(0, 280);
      if (!text) return res.status(400).json({ error: 'La nota no puede estar vacía' });

      if (useDb) {
        const [row] = await sb('notes', { method: 'POST', body: JSON.stringify({ author, body: text }) });
        return res.status(201).json(row);
      }
      const row = { id: memory.length + 1, author, body: text, created_at: new Date().toISOString() };
      memory.push(row);
      return res.status(201).json(row);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
