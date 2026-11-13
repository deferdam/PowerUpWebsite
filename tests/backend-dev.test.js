// Serveur de développement : protection contre la traversée de chemin et contre le DNS rebinding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isLocalHost, resolveStaticPath } from '../scripts/dev.mjs';

const DIST = path.resolve('dist-test-root');

test('chemins normaux : restent dans dist/', () => {
  assert.equal(resolveStaticPath(DIST, '/'), DIST);
  assert.equal(resolveStaticPath(DIST, '/en/privacy'), path.join(DIST, 'en', 'privacy'));
  assert.equal(resolveStaticPath(DIST, '/assets/app.js?v=1'), path.join(DIST, 'assets', 'app.js'));
  assert.equal(resolveStaticPath(DIST, '/caf%C3%A9.png'), path.join(DIST, 'café.png'));
});

test('traversée refusée : ../, %2e%2e, antislash, octet nul, encodage invalide', () => {
  const attacks = [
    '/../package.json',
    '/assets/../../.env',
    '/%2e%2e/.env',
    '/%2E%2E/%2E%2E/etc/passwd',
    '/assets/%2e%2e%2f%2e%2e%2f.env',
    '/..%2f.env',
    '/..%5c.env',
    '/%5c..%5c.env',
    '/index.html%00.png',
    '/%E0%A4%A',
  ];
  for (const attack of attacks) assert.equal(resolveStaticPath(DIST, attack), null, attack);
});

test('en-tête Host : seuls localhost:<port> et 127.0.0.1:<port> sont acceptés', () => {
  assert.equal(isLocalHost('localhost:3000', 3000), true);
  assert.equal(isLocalHost('127.0.0.1:3000', 3000), true);
  for (const host of [
    'evil.example:3000', // DNS rebinding
    'localhost.evil.example:3000',
    '192.168.1.20:3000', // autre machine du réseau
    'localhost', // port manquant
    'localhost:4000', // autre port
    '',
    undefined,
  ]) {
    assert.equal(isLocalHost(host, 3000), false, String(host));
  }
});
