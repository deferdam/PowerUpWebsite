// Lien vers le questionnaire Tally : bonne langue, prix vu par le visiteur, aucun identifiant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionnaireUrl } from '../src/shared/questionnaire.js';

const BASE = { fr: 'https://tally.so/r/FR', en: 'https://tally.so/r/EN', it: '' };

test('choisit la version de la langue et ajoute les champs cachés', () => {
  const fr = new URL(questionnaireUrl(BASE, { lang: 'fr', priceCents: 350, source: 'instagram' }));
  assert.equal(fr.origin + fr.pathname, 'https://tally.so/r/FR');
  assert.equal(fr.searchParams.get('p'), '3,50');
  assert.equal(fr.searchParams.get('arm'), '350');
  assert.equal(fr.searchParams.get('lang'), 'fr');
  assert.equal(fr.searchParams.get('src'), 'site_instagram');
  assert.deepEqual([...fr.searchParams.keys()].sort(), ['arm', 'lang', 'p', 'src']);

  const en = new URL(questionnaireUrl(BASE, { lang: 'en', priceCents: 250 }));
  assert.equal(en.pathname, '/r/EN');
  assert.equal(en.searchParams.get('p'), '2.50');
  assert.equal(en.searchParams.get('src'), 'site_direct');
});

test('format italien et URL unique pour toutes les langues', () => {
  const it = new URL(questionnaireUrl('https://tally.so/r/ALL', { lang: 'it', priceCents: 450 }));
  assert.equal(it.pathname, '/r/ALL');
  assert.equal(it.searchParams.get('p'), '4,50');
});

test('aucun questionnaire configuré → chaîne vide (lien masqué)', () => {
  assert.equal(questionnaireUrl(BASE, { lang: 'it', priceCents: 350 }), '');
  assert.equal(questionnaireUrl('', { lang: 'fr', priceCents: 350 }), '');
});
