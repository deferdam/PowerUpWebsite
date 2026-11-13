// POST /api/event : validation, enregistrement, prix recalculé côté serveur, rate limit.
import { test, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import config from '../site.config.js';
import { priceFor } from '../src/shared/pricing.js';
import { POST } from '../api/event.js';
import { freshDb, makeRequest, nextIp, rows, setTestEnv } from './backend-helpers.js';
import { resetDbForTests } from '../lib/db.js';

setTestEnv();
let db;
beforeEach(async () => {
  db = await freshDb();
});
after(() => resetDbForTests()); // ferme la base en mémoire (sinon Node peut planter à la sortie)

const send = (body, opts = {}) => POST(makeRequest('/api/event', { body, ...opts }));
const base = () => ({ visitorId: randomUUID(), event: 'page_vue', lang: 'fr' });

test('chaque événement client est enregistré avec tous ses champs', async () => {
  for (const event of ['page_vue', 'clic_precommande', 'clic_questionnaire']) {
    const visitorId = randomUUID();
    const res = await send({
      visitorId,
      event,
      lang: 'en',
      utm_source: 'Instagram_Story',
      utm_medium: 'social',
      utm_campaign: 'lancement-1',
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const [row] = await rows(db, 'SELECT * FROM events WHERE visitor_id = ?', [visitorId]);
    assert.equal(row.event, event);
    assert.equal(row.lang, 'en');
    assert.equal(row.source, 'instagram_story');
    assert.equal(row.utm_source, 'instagram_story');
    assert.equal(row.utm_medium, 'social');
    assert.equal(row.utm_campaign, 'lancement-1');
    assert.equal(row.price_mode, config.PRICE_MODE);
    assert.equal(row.price_cents, priceFor(config, visitorId).priceCents);
    assert.ok(!Number.isNaN(Date.parse(row.ts)) && row.ts.endsWith('Z'));
  }
});

test('sans UTM, la source vaut "direct"', async () => {
  const body = base();
  assert.equal((await send(body)).status, 204);
  const [row] = await rows(db, 'SELECT source, utm_source, utm_medium, utm_campaign FROM events');
  assert.deepEqual({ ...row }, { source: 'direct', utm_source: null, utm_medium: null, utm_campaign: null });
});

test('UTM invalides => null et source "direct" (pas d\'erreur)', async () => {
  const res = await send({ ...base(), utm_source: 'insta<script>', utm_medium: 'a b', utm_campaign: 42 });
  assert.equal(res.status, 204);
  const [row] = await rows(db, 'SELECT source, utm_source, utm_medium, utm_campaign FROM events');
  assert.deepEqual({ ...row }, { source: 'direct', utm_source: null, utm_medium: null, utm_campaign: null });
});

test('UTM trop long : tronqué à 64 caractères', async () => {
  assert.equal((await send({ ...base(), utm_campaign: 'x'.repeat(100) })).status, 204);
  const [row] = await rows(db, 'SELECT utm_campaign FROM events');
  assert.equal(row.utm_campaign, 'x'.repeat(64));
});

test('"email_soumis" est refusé sur /api/event', async () => {
  const res = await send({ ...base(), event: 'email_soumis' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'invalid_event' });
  assert.equal((await rows(db, 'SELECT * FROM events')).length, 0);
});

test('un champ "price" envoyé par le client => 400', async () => {
  const res = await send({ ...base(), price: 0.01 });
  assert.equal(res.status, 400);
  assert.equal((await rows(db, 'SELECT * FROM events')).length, 0);
});

test('le prix enregistré est toujours celui calculé par le serveur', async () => {
  for (let i = 0; i < 20; i++) {
    const visitorId = randomUUID();
    await send({ visitorId, event: 'page_vue', lang: 'it' });
    const [row] = await rows(db, 'SELECT price_cents FROM events WHERE visitor_id = ?', [visitorId]);
    assert.equal(row.price_cents, priceFor(config, visitorId).priceCents);
  }
});

test('clé inconnue => 400', async () => {
  const res = await send({ ...base(), admin: true });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'unknown_field' });
});

test('corps trop gros => 413 (taille réelle et content-length annoncé)', async () => {
  const big = JSON.stringify({ ...base(), utm_campaign: 'x'.repeat(3000) });
  assert.equal((await send(big)).status, 413);
  const declared = await send(JSON.stringify(base()), { headers: { 'content-length': '5000' } });
  assert.equal(declared.status, 413);
});

test('mauvaise origine => 403', async () => {
  assert.equal((await send(base(), { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await send(base(), { headers: { origin: 'null' } })).status, 403);
  assert.equal((await send(base(), { headers: { origin: null } })).status, 403); // ni Origin ni Sec-Fetch-Site
  assert.equal((await send(base(), { headers: { origin: null, 'sec-fetch-site': 'cross-site' } })).status, 403);
});

test('sans Origin mais avec Sec-Fetch-Site: same-origin => accepté', async () => {
  const res = await send(base(), { headers: { origin: null, 'sec-fetch-site': 'same-origin' } });
  assert.equal(res.status, 204);
});

test('mauvais Content-Type => 415 ; charset toléré', async () => {
  assert.equal((await send(base(), { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await send(base(), { headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 204);
});

test('JSON invalide ou qui n\'est pas un objet => 400', async () => {
  assert.equal((await send('{pas du json')).status, 400);
  assert.equal((await send('[1,2]')).status, 400);
  assert.equal((await send('null')).status, 400);
  assert.equal((await send('"texte"')).status, 400);
});

test('identifiant visiteur invalide => 400', async () => {
  for (const visitorId of ['abc', '123e4567-e89b-12d3-a456-426614174000', randomUUID().toUpperCase(), 12]) {
    const res = await send({ ...base(), visitorId });
    assert.equal(res.status, 400, String(visitorId));
  }
});

test('langue invalide => 400', async () => {
  for (const lang of ['de', 'FR', '', null]) assert.equal((await send({ ...base(), lang })).status, 400);
});

test('61e événement dans la minute => 429 (une autre IP reste acceptée)', async () => {
  // Horloge figée en début de minute : la fenêtre ne peut pas changer pendant le test.
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 20, 10, 0, 0) });
  try {
    const ip = nextIp();
    for (let i = 0; i < 60; i++) assert.equal((await send(base(), { ip })).status, 204, `requête ${i + 1}`);
    const blocked = await send(base(), { ip });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: 'too_many_requests' });
    assert.equal((await send(base(), { ip: nextIp() })).status, 204);

    // L'IP n'est pas stockée en clair
    const keys = await rows(db, 'SELECT key FROM rate_limits');
    for (const { key } of keys) assert.match(key, /^[0-9a-f]{64}$/);

    // Minute suivante : de nouveau accepté
    mock.timers.setTime(Date.UTC(2026, 10, 20, 10, 1, 0));
    assert.equal((await send(base(), { ip })).status, 204);
  } finally {
    mock.timers.reset();
  }
});
