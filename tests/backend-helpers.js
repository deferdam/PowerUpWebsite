// Outils partagés par les tests backend (ce fichier n'est pas lui-même un test).
import { createClient } from '@libsql/client';
import { getDb, setDbForTests } from '../lib/db.js';

export const ADMIN_PASSWORD = 'mot-de-passe-de-test-123';

/** Variables d'environnement de test (jamais de vrais secrets). */
export function setTestEnv() {
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.APP_SECRET = 'secret-de-test-0123456789abcdef0123456789abcdef';
  delete process.env.VERCEL;
}

/** Nouvelle base vide en mémoire, schéma créé ; renvoie le client pour pouvoir l'interroger. */
export async function freshDb() {
  const db = createClient({ url: ':memory:' });
  setDbForTests(db);
  await getDb(); // crée les tables
  return db;
}

let ipCounter = 0;
/** Une IP différente à chaque appel (pour ne pas être gêné par le rate limit). */
export function nextIp() {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/** Construit une requête comme le ferait le navigateur. */
export function makeRequest(path, { method = 'POST', body, ip = nextIp(), headers = {} } = {}) {
  const h = { origin: 'https://test.local', 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers };
  for (const [k, v] of Object.entries(h)) if (v === null) delete h[k];
  const init = { method, headers: h };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`https://test.local${path}`, init);
}

/** Enregistre un "page_vue" pour ce visiteur, comme le ferait le navigateur au chargement de la page. */
export async function addPageView(db, visitorId, lang = 'fr') {
  await db.execute({
    sql: `INSERT INTO events (ts, visitor_id, event, lang, price_cents, price_mode, source)
          VALUES (?, ?, 'page_vue', ?, 250, 'random', 'direct')`,
    args: [new Date().toISOString(), visitorId, lang],
  });
}

export async function rows(db, sql, args = []) {
  return (await db.execute({ sql, args })).rows;
}
