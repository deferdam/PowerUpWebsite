// Tableau de bord : protection par mot de passe et cookie signé, statistiques, exports CSV.
import { test, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as login from '../api/admin/login.js';
import * as logout from '../api/admin/logout.js';
import * as stats from '../api/admin/stats.js';
import * as exportEvents from '../api/admin/export-events.js';
import * as exportEmails from '../api/admin/export-emails.js';
import * as email from '../api/email.js';
import { makeSessionValue } from '../lib/auth.js';
import { csvCell, toCsv } from '../lib/csv.js';
import { wilson } from '../lib/stats.js';
import { ADMIN_PASSWORD, addPageView, freshDb, makeRequest, nextIp, setTestEnv } from './backend-helpers.js';
import { resetDbForTests } from '../lib/db.js';

let db;
beforeEach(async () => {
  setTestEnv();
  db = await freshDb();
});
after(() => resetDbForTests()); // ferme la base en mémoire (sinon Node peut planter à la sortie)
afterEach(() => mock.timers.reset());

const doLogin = (password, ip) => login.POST(makeRequest('/api/admin/login', { body: { password }, ip }));
const get = (mod, path, cookie) =>
  mod.GET(makeRequest(path, { method: 'GET', headers: cookie ? { cookie } : {} }));

/** Se connecte et renvoie "__Host-pu_admin=<valeur>" à renvoyer dans l'en-tête Cookie. */
async function loginCookie() {
  const res = await doLogin(ADMIN_PASSWORD);
  assert.equal(res.status, 204);
  return res.headers.get('set-cookie').split(';')[0];
}

const PROTECTED = [
  [stats, '/api/admin/stats'],
  [exportEvents, '/api/admin/export-events'],
  [exportEmails, '/api/admin/export-emails'],
];

test('stats et exports sans cookie => 401', async () => {
  for (const [mod, path] of PROTECTED) {
    const res = await get(mod, path);
    assert.equal(res.status, 401, path);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  }
});

test('cookie fabriqué, falsifié ou expiré => 401', async () => {
  const valid = await loginCookie();
  const [, value] = valid.split('=');
  const [exp, sig] = value.split('.');
  const lastChar = sig.at(-1) === 'A' ? 'B' : 'A';
  const bad = [
    '__Host-pu_admin=9999999999999.abcdefghijklmnopqrstuvwxyz0123456789abcdefg',
    '__Host-pu_admin=n_importe_quoi',
    `__Host-pu_admin=${exp}.${sig.slice(0, -1)}${lastChar}`, // signature modifiée
    `__Host-pu_admin=${Number(exp) + 3600000}.${sig}`, // expiration repoussée sans re-signer
    `pu_admin=${value}`, // mauvais nom de cookie
    `__Host-pu_admin=${makeSessionValue(Date.now() - 1000)}`, // bien signé mais expiré
  ];
  for (const cookie of bad) {
    for (const [mod, path] of PROTECTED) assert.equal((await get(mod, path, cookie)).status, 401, `${path} ${cookie}`);
  }
  // Signé avec un autre secret
  const otherCookie = valid;
  process.env.APP_SECRET = 'un-autre-secret-de-test-0123456789abcdef0123';
  assert.equal((await get(stats, '/api/admin/stats', otherCookie)).status, 401);
});

test('le cookie expire après 8 heures', async () => {
  const t0 = Date.UTC(2026, 10, 20, 8, 0, 0);
  mock.timers.enable({ apis: ['Date'], now: t0 });
  const cookie = await loginCookie();
  mock.timers.setTime(t0 + 8 * 3600 * 1000 - 1000);
  assert.equal((await get(stats, '/api/admin/stats', cookie)).status, 200);
  mock.timers.setTime(t0 + 8 * 3600 * 1000 + 1000);
  assert.equal((await get(stats, '/api/admin/stats', cookie)).status, 401);
});

test('mauvais mot de passe => 401, 6e tentative => 429', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 20, 10, 0, 0) });
  const ip = nextIp();
  for (let i = 0; i < 5; i++) {
    const res = await doLogin('mauvais-mot-de-passe', ip);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
  }
  assert.equal((await doLogin(ADMIN_PASSWORD, ip)).status, 429); // même le bon mot de passe est bloqué
  assert.equal((await doLogin(ADMIN_PASSWORD, nextIp())).status, 204);
});

test('mot de passe d\'un mauvais type ou clé inconnue => refusé', async () => {
  assert.equal((await doLogin(12345)).status, 401);
  const extra = await login.POST(makeRequest('/api/admin/login', { body: { password: ADMIN_PASSWORD, admin: true } }));
  assert.equal(extra.status, 400);
  const evil = await login.POST(
    makeRequest('/api/admin/login', { body: { password: ADMIN_PASSWORD }, headers: { origin: 'https://evil.example' } }),
  );
  assert.equal(evil.status, 403);
});

test('ADMIN_PASSWORD absent ou trop court => 503', async () => {
  for (const value of [undefined, 'court123456']) {
    if (value === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = value;
    const res = await doLogin(value || 'peu-importe-ici');
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'admin_disabled' });
    assert.equal((await get(stats, '/api/admin/stats')).status, 503);
  }
});

test('en production sans APP_SECRET => 503', async () => {
  delete process.env.APP_SECRET;
  process.env.VERCEL = '1';
  try {
    assert.equal((await doLogin(ADMIN_PASSWORD)).status, 503);
    assert.equal((await get(stats, '/api/admin/stats')).status, 503);
  } finally {
    delete process.env.VERCEL;
  }
});

test('bon mot de passe => cookie __Host- sécurisé, puis accès aux stats', async () => {
  const res = await doLogin(ADMIN_PASSWORD);
  assert.equal(res.status, 204);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /^__Host-pu_admin=\d+\.[A-Za-z0-9_-]+;/);
  for (const attr of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=28800']) {
    assert.ok(setCookie.split('; ').includes(attr), `attribut manquant : ${attr}`);
  }
  assert.ok(!/Domain=/i.test(setCookie));
  const ok = await get(stats, '/api/admin/stats', setCookie.split(';')[0]);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('déconnexion => cookie effacé (Max-Age=0)', async () => {
  const res = await logout.POST(makeRequest('/api/admin/logout', { body: {} }));
  assert.equal(res.status, 204);
  assert.match(res.headers.get('set-cookie'), /^__Host-pu_admin=;.*Max-Age=0/);
});

// --- Statistiques sur un jeu de données connu ---------------------------------------------

async function insertEvent(visitorId, event, priceCents, source) {
  await db.execute({
    sql: `INSERT INTO events (ts, visitor_id, event, lang, price_cents, price_mode, source, utm_source)
          VALUES (?, ?, ?, 'fr', ?, 'random', ?, ?)`,
    args: [new Date().toISOString(), visitorId, event, priceCents, source, source === 'direct' ? null : source],
  });
}

/** Crée un visiteur avec la liste de ses événements. */
async function visitor(priceCents, source, events) {
  const id = randomUUID();
  for (const e of events) await insertEvent(id, e, priceCents, source);
}

async function seed() {
  const IG = 'instagram_story';
  // 2,50 € / direct : 4 visiteurs, 2 clics, 1 e-mail, 1 questionnaire
  await visitor(250, 'direct', ['page_vue', 'page_vue', 'clic_precommande', 'clic_precommande', 'email_soumis', 'clic_questionnaire']);
  await visitor(250, 'direct', ['page_vue', 'clic_precommande']);
  await visitor(250, 'direct', ['page_vue']);
  await visitor(250, 'direct', ['page_vue']);
  // 2,50 € / instagram : 2 visiteurs, 1 clic
  await visitor(250, IG, ['page_vue', 'clic_precommande']);
  await visitor(250, IG, ['page_vue']);
  // 3,50 € / direct : 1 visiteur
  await visitor(350, 'direct', ['page_vue', 'page_vue']);
  // 3,50 € / instagram : 3 visiteurs, 3 clics, 2 e-mails
  await visitor(350, IG, ['page_vue', 'clic_precommande', 'email_soumis']);
  await visitor(350, IG, ['page_vue', 'clic_precommande', 'email_soumis']);
  await visitor(350, IG, ['page_vue', 'clic_precommande']);
}

const pick = (r) => [r.price, r.source, r.visitors, r.clickers, r.emails, r.questionnaire];

test('stats : chiffres exacts pour 2 prix x 2 sources', async () => {
  await seed();
  const res = await get(stats, '/api/admin/stats', await loginCookie());
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.priceMode, 'random');
  assert.ok(!Number.isNaN(Date.parse(data.generatedAt)));
  assert.deepEqual(data.rows.map(pick), [
    [2.5, 'direct', 4, 2, 1, 1],
    [2.5, 'instagram_story', 2, 1, 0, 0],
    [3.5, 'direct', 1, 0, 0, 0],
    [3.5, 'instagram_story', 3, 3, 2, 0],
  ]);
  assert.deepEqual(data.byPrice.map(pick), [
    [2.5, '*', 6, 3, 1, 1],
    [3.5, '*', 4, 3, 2, 0],
  ]);
  assert.deepEqual(data.bySource.map(pick), [
    [null, 'direct', 5, 2, 1, 1],
    [null, 'instagram_story', 5, 4, 2, 0],
  ]);
  assert.deepEqual(pick(data.total), [null, '*', 10, 6, 3, 1]);

  const first = data.rows[0];
  assert.equal(first.clickRate, 0.5);
  assert.equal(first.conversion, 0.25);
  assert.deepEqual(first.clickRateCI, wilson(2, 4));
  assert.deepEqual(first.conversionCI, wilson(1, 4));
  assert.equal(data.total.clickRate, 0.6);
  assert.equal(data.total.conversion, 0.3);
  assert.equal(data.byPrice[1].clickRate, 0.75);
});

test('intervalle de Wilson : valeurs de référence', () => {
  const [lo, hi] = wilson(5, 10);
  assert.ok(Math.abs(lo - 0.2366) < 1e-4 && Math.abs(hi - 0.7634) < 1e-4);
  const [lo0, hi0] = wilson(0, 10);
  assert.equal(lo0, 0);
  assert.ok(Math.abs(hi0 - 0.2775) < 1e-4);
  assert.deepEqual(wilson(0, 0), [0, 1]);
});

// --- Exports CSV -----------------------------------------------------------------------------

test('export des événements : en-tête correct, aucun e-mail', async () => {
  const visitorId = randomUUID();
  await addPageView(db, visitorId);
  const res0 = await email.POST(
    makeRequest('/api/email', {
      body: { email: 'fan@example.com', consent: true, website: '', visitorId, lang: 'fr' },
    }),
  );
  assert.equal(res0.status, 200);
  const res = await get(exportEvents, '/api/admin/export-events', await loginCookie());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="events.csv"');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // BOM UTF-8
  const text = await res.text();
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'ts,visitor_id,event,lang,price,price_mode,source,utm_source,utm_medium,utm_campaign');
  assert.equal(lines.length, 3); // page_vue + email_soumis
  assert.match(lines[2], /,email_soumis,fr,\d\.\d\d,random,direct,,,$/);
  assert.ok(!text.includes('@'));
});

test('export des e-mails : contient les adresses', async () => {
  for (const address of ['a@example.com', 'b@example.org']) {
    await email.POST(
      makeRequest('/api/email', { body: { email: address, consent: true, visitorId: randomUUID(), lang: 'it' } }),
    );
  }
  const res = await get(exportEmails, '/api/admin/export-emails', await loginCookie());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="emails.csv"');
  const lines = (await res.text()).replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'email,lang,consent_at,created_at');
  assert.match(lines[1], /^a@example\.com,it,\d{4}-\d\d-\d\d,\d{4}-\d\d-\d\d$/);
  assert.match(lines[2], /^b@example\.org,it,/);
});

test('CSV : une cellule "=cmd()" est neutralisée dans l\'export', async () => {
  await db.execute({
    sql: `INSERT INTO events (ts, visitor_id, event, lang, price_cents, price_mode, source, utm_campaign)
          VALUES ('2026-11-20T10:00:00.000Z', 'v', 'page_vue', 'fr', 250, 'random', '@source', ?)`,
    args: ['=cmd()'],
  });
  const text = await (await get(exportEvents, '/api/admin/export-events', await loginCookie())).text();
  assert.ok(text.includes(",'=cmd()"));
  assert.ok(!/,=cmd\(\)/.test(text));
  assert.ok(text.includes(",'@source,"));
});

test('CSV : échappement RFC 4180 et neutralisation des formules', () => {
  assert.equal(csvCell('=cmd()'), "'=cmd()");
  assert.equal(csvCell('+33'), "'+33");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\tx'), "'\tx");
  assert.equal(csvCell('\rx'), '"\'\rx"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('normal'), 'normal');
  assert.equal(toCsv(['a', 'b'], [['1', null]]), '﻿a,b\r\n1,\r\n');
});
