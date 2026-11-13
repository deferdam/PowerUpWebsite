// Attribution des prix : mode aléatoire stable et uniforme, mode calendrier à l'heure de Paris.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import config from '../site.config.js';
import { priceFor } from '../src/shared/pricing.js';

const RANDOM = { PRICE_MODE: 'random', PRICES: [2.5, 3.5, 4.5], PRICE_SCHEDULE: [] };
const SCHEDULE = {
  PRICE_MODE: 'schedule',
  PRICES: [2.5, 3.5, 4.5],
  PRICE_SCHEDULE: [
    { from: '2026-11-30', price: 4.5 }, // volontairement dans le désordre
    { from: '2026-11-16', price: 2.5 },
    { from: '2026-11-23', price: 3.5 },
  ],
};

test('aléatoire : un même visiteur reçoit toujours le même prix (1000 appels)', () => {
  const id = randomUUID();
  const first = priceFor(RANDOM, id).priceCents;
  for (let i = 0; i < 1000; i++) assert.equal(priceFor(RANDOM, id, new Date(Date.now() + i * 86400000)).priceCents, first);
});

test('aléatoire : 30 000 visiteurs se répartissent entre 31 % et 35 % par prix', () => {
  const counts = { 250: 0, 350: 0, 450: 0 };
  const n = 30000;
  for (let i = 0; i < n; i++) {
    const { priceCents, mode } = priceFor(RANDOM, randomUUID());
    assert.equal(mode, 'random');
    counts[priceCents] += 1;
  }
  for (const [cents, count] of Object.entries(counts)) {
    const share = count / n;
    assert.ok(share > 0.31 && share < 0.35, `${cents} centimes : ${(share * 100).toFixed(2)} %`);
  }
});

test('calendrier : avant la 1re date => 1er prix, après la dernière => dernier prix', () => {
  assert.deepEqual(priceFor(SCHEDULE, randomUUID(), new Date('2026-01-01T12:00:00Z')), { priceCents: 250, mode: 'schedule' });
  assert.equal(priceFor(SCHEDULE, randomUUID(), new Date('2026-11-15T22:59:00Z')).priceCents, 250);
  assert.equal(priceFor(SCHEDULE, randomUUID(), new Date('2027-05-01T12:00:00Z')).priceCents, 450);
});

test('calendrier : changement de semaine à minuit heure de Paris (hiver, UTC+1)', () => {
  const id = randomUUID();
  // 22 nov. 22:59 UTC = 23:59 à Paris (encore semaine 1) ; 23:00 UTC = minuit le 23 (semaine 2)
  assert.equal(priceFor(SCHEDULE, id, new Date('2026-11-22T22:59:59Z')).priceCents, 250);
  assert.equal(priceFor(SCHEDULE, id, new Date('2026-11-22T23:00:00Z')).priceCents, 350);
  assert.equal(priceFor(SCHEDULE, id, new Date('2026-11-29T22:59:59Z')).priceCents, 350);
  assert.equal(priceFor(SCHEDULE, id, new Date('2026-11-29T23:00:00Z')).priceCents, 450);
  // Le 16 nov. démarre aussi à minuit Paris
  assert.equal(priceFor(SCHEDULE, id, new Date('2026-11-15T23:00:00Z')).priceCents, 250);
});

test('calendrier : changement à minuit heure de Paris en été (UTC+2)', () => {
  const summer = {
    PRICE_MODE: 'schedule',
    PRICES: [2.5, 3.5],
    PRICE_SCHEDULE: [
      { from: '2026-06-29', price: 2.5 },
      { from: '2026-07-06', price: 3.5 },
    ],
  };
  assert.equal(priceFor(summer, randomUUID(), new Date('2026-07-05T21:59:59Z')).priceCents, 250);
  assert.equal(priceFor(summer, randomUUID(), new Date('2026-07-05T22:00:00Z')).priceCents, 350);
});

test('la configuration du site est cohérente avec le calcul des prix', () => {
  const { priceCents } = priceFor(config, randomUUID());
  assert.ok(config.PRICES.map((p) => Math.round(p * 100)).includes(priceCents));
});
