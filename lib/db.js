// Accès à la base SQLite / libSQL (Turso en production, fichier local.db en local).
// Toutes les requêtes du projet sont paramétrées avec « ? » : jamais de concaténation de valeurs.
import { createClient } from '@libsql/client';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, ts TEXT NOT NULL, visitor_id TEXT NOT NULL, event TEXT NOT NULL,
    lang TEXT NOT NULL, price_cents INTEGER NOT NULL, price_mode TEXT NOT NULL, source TEXT NOT NULL,
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT)`,
  `CREATE INDEX IF NOT EXISTS events_visitor ON events(visitor_id, event)`,
  `CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, lang TEXT NOT NULL,
    consent_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (key, window_start))`,
];

let client = null; // client mémorisé (réutilisé entre deux appels d'une même fonction Vercel)
let ready = null; // promesse unique de création du schéma

function createDefaultClient() {
  const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  return createClient({ url, authToken });
}

/** Renvoie le client de base de données, après avoir créé les tables si besoin. */
export async function getDb() {
  if (!client) client = createDefaultClient();
  if (!ready) {
    ready = client.batch(SCHEMA, 'write').catch((err) => {
      ready = null; // on retentera au prochain appel
      throw err;
    });
  }
  await ready;
  return client;
}

/**
 * Tests : remplace la base (par exemple createClient({ url: ':memory:' })).
 * L'ancien client est fermé : des clients libSQL laissés ouverts font planter Node à la sortie.
 */
export function setDbForTests(testClient) {
  if (client && client !== testClient) client.close();
  client = testClient;
  ready = null;
}

/** Tests : ferme et oublie le client courant (à appeler à la fin de chaque fichier de test). */
export function resetDbForTests() {
  client?.close();
  client = null;
  ready = null;
}
