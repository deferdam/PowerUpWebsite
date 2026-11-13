// En-têtes de sécurité déclarés dans vercel.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const headersOf = (source) => {
  const rule = vercel.headers.find((r) => r.source === source);
  assert.ok(rule, `règle manquante pour ${source}`);
  return Object.fromEntries(rule.headers.map((h) => [h.key.toLowerCase(), h.value]));
};

test('toutes les pages : CSP stricte, HSTS, nosniff', () => {
  const h = headersOf('/(.*)');
  const csp = h['content-security-policy'];
  assert.ok(csp, 'CSP manquante');
  assert.match(csp, /(^|;)\s*script-src 'self'(;|$)/);
  assert.match(csp, /(^|;)\s*style-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  assert.match(h['strict-transport-security'], /max-age=\d{8,}/);
  assert.equal(h['x-content-type-options'], 'nosniff');
});

test('/api et /admin : jamais mis en cache', () => {
  assert.equal(headersOf('/api/(.*)')['cache-control'], 'no-store');
  assert.equal(headersOf('/admin(.*)')['cache-control'], 'no-store');
});
