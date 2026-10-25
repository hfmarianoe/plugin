// Helpers to exercise the serverless handler without a server.
// Lives outside test/ because `node --test` runs every .js file under test/.
const path = require('node:path');

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL_ENV'];

// Loads a fresh copy of the handler with the given env (module reads env at load time).
function loadHandler(env = {}) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  const file = path.join(__dirname, '..', 'api', 'notes.js');
  delete require.cache[require.resolve(file)];
  return require(file);
}

// Calls the handler with a fake req/res and resolves with { code, body, headers }.
function makeCall(handler) {
  return (req) =>
    new Promise((resolve, reject) => {
      const headers = {};
      const res = {
        status(code) { res.code = code; return res; },
        setHeader(k, v) { headers[k] = v; },
        json(body) { resolve({ code: res.code, body, headers }); return res; },
      };
      Promise.resolve(handler({ headers: { 'content-type': 'application/json' }, ...req }, res)).catch(reject);
    });
}

// Silences console.error while fn runs (handler logs unexpected errors) and returns what was logged.
async function withSilencedErrors(fn) {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}

module.exports = { loadHandler, makeCall, withSilencedErrors };
