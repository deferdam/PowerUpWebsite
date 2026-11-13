// POST /api/email : consentement obligatoire, validation, honeypot, doublons, séparation e-mails / événements.
import { test, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { POST } from '../api/email.js';
import { addPageView, freshDb, makeRequest, nextIp, rows, setTestEnv } from './backend-helpers.js';
import { resetDbForTests } from '../lib/db.js';

setTestEnv();
let db;
beforeEach(async () => {
  db = await freshDb();
});
after(() => resetDbForTests()); // ferme la base en mémoire (sinon Node peut planter à la sortie)

const send = (body, opts = {}) => POST(makeRequest('/api/email', { body, ...opts }));
const valid = (extra = {}) => ({
  email: 'Sportif@Example.com',
  consent: true,
  website: '',
  visitorId: randomUUID(),
  lang: 'fr',
  ...extra,
});
const count = async (table) => (await rows(db, `SELECT COUNT(*) AS n FROM ${table}`))[0].n;
const emailEvents = (visitorId) =>
  rows(db, "SELECT * FROM events WHERE visitor_id = ? AND event = 'email_soumis'", [visitorId]);
/** Visiteur « normal » : il a déjà un page_vue (envoyé par le navigateur au chargement). */
async function seenVisitor() {
  const visitorId = randomUUID();
  await addPageView(db, visitorId);
  return visitorId;
}

test('e-mail valide avec consentement => 200, e-mail normalisé, événement sans adresse', async () => {
  const visitorId = await seenVisitor();
  const res = await send(valid({ visitorId, utm_source: 'instagram_bio' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const [email] = await rows(db, 'SELECT * FROM emails');
  assert.equal(email.email, 'sportif@example.com');
  assert.equal(email.lang, 'fr');
  // Dates arrondies au jour : impossible de relier l'adresse à un événement par l'horodatage.
  assert.match(email.consent_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(email.created_at, /^\d{4}-\d{2}-\d{2}$/);
  const events = await emailEvents(visitorId);
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'instagram_bio');
});

test('visiteur sans page_vue (opt-out équipe ?interne=1) => e-mail gardé, aucun événement', async () => {
  const visitorId = randomUUID(); // aucun page_vue : le navigateur n'a rien envoyé
  const res = await send(valid({ visitorId }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(await count('emails'), 1);
  assert.equal(await count('events'), 0); // la conversion n'est pas gonflée
});

test('la table emails ne contient ni visitor_id ni prix', async () => {
  const columns = (await rows(db, 'SELECT name FROM pragma_table_info(\'emails\')')).map((r) => r.name);
  assert.deepEqual(columns.sort(), ['consent_at', 'created_at', 'email', 'id', 'lang']);
});

test('consentement absent, false ou "true" (chaîne) => 400 et rien en base', async () => {
  for (const consent of [undefined, false, 'true', 1, null]) {
    const body = valid({ consent });
    if (consent === undefined) delete body.consent;
    const res = await send(body);
    assert.equal(res.status, 400, `consent=${JSON.stringify(consent)}`);
    assert.deepEqual(await res.json(), { error: 'consent_required' });
  }
  assert.equal(await count('emails'), 0);
  assert.equal(await count('events'), 0);
});

test('e-mails invalides => 400 invalid_email', async () => {
  const invalid = [
    'pas-un-email',
    'a@b',
    '@example.com',
    'a b@example.com',
    'a@exa mple.com',
    '<script>@example.com',
    'a@-example.com',
    'a@example..com',
    `${'a'.repeat(65)}@example.com`,
    `a@${'b'.repeat(250)}.com`,
    '',
    42,
  ];
  for (const email of invalid) {
    const res = await send(valid({ email }));
    assert.equal(res.status, 400, `email=${email}`);
    assert.deepEqual(await res.json(), { error: 'invalid_email' });
  }
  assert.equal(await count('emails'), 0);
  assert.equal(await count('events'), 0);
});

test('champ piège (honeypot) rempli => 200 mais rien n\'est enregistré', async () => {
  const res = await send(valid({ website: 'http://spam.example' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(await count('emails'), 0);
  assert.equal(await count('events'), 0);
});

test('doublon => même réponse 200 et une seule ligne', async () => {
  const visitorId = randomUUID();
  assert.equal((await send(valid({ visitorId }))).status, 200);
  const again = await send(valid({ visitorId, email: '  SPORTIF@example.com ' }));
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true });
  assert.equal(await count('emails'), 1);
});

test('"email_soumis" inséré une seule fois par visiteur, sans aucune adresse dans events', async () => {
  const visitorId = await seenVisitor();
  const other = await seenVisitor();
  await send(valid({ visitorId, email: 'un@example.com' }));
  await send(valid({ visitorId, email: 'deux@example.com' }));
  await send(valid({ visitorId: other, email: 'trois@example.com' })); // autre visiteur
  assert.equal((await emailEvents(visitorId)).length, 1);
  assert.equal((await emailEvents(other)).length, 1);
  assert.equal(await count('events'), 4); // 2 page_vue + 2 email_soumis
  assert.equal(await count('emails'), 3);

  for (const row of await rows(db, 'SELECT * FROM events')) {
    for (const value of Object.values(row)) assert.ok(!String(value).includes('@'), `valeur suspecte : ${value}`);
  }
});

test('clé inconnue ou prix envoyé => 400', async () => {
  assert.equal((await send(valid({ price: 1 }))).status, 400);
  assert.equal((await send(valid({ visitor_id: 'x' }))).status, 400);
});

test('visitorId ou langue invalide => 400', async () => {
  assert.equal((await send(valid({ visitorId: 'abc' }))).status, 400);
  assert.equal((await send(valid({ lang: 'es' }))).status, 400);
  assert.equal(await count('emails'), 0);
});

test('6e envoi en 10 minutes depuis la même IP => 429', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 20, 10, 0, 0) });
  try {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      assert.equal((await send(valid({ email: `user${i}@example.com` }), { ip })).status, 200);
    }
    const blocked = await send(valid({ email: 'user6@example.com' }), { ip });
    assert.equal(blocked.status, 429);
    assert.equal(await count('emails'), 5);
    assert.equal((await send(valid({ email: 'autre@example.com' }), { ip: nextIp() })).status, 200);
  } finally {
    mock.timers.reset();
  }
});

test('mauvaise origine => 403, mauvais Content-Type => 415', async () => {
  assert.equal((await send(valid(), { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await send(valid(), { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal(await count('emails'), 0);
});
