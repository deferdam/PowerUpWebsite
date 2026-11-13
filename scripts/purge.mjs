// Suppression des données.
//   npm run purge:emails -- --yes   vide la table des e-mails (les statistiques restent intactes)
//   npm run purge:all -- --yes      supprime les trois tables (events, emails, rate_limits)
// Sans --yes, le script affiche seulement ce qu'il ferait.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile); // avant d'ouvrir la base (TURSO_DATABASE_URL)

const { getDb } = await import('../lib/db.js');

const mode = process.argv[2];
const confirmed = process.argv.includes('--yes');
const target = process.env.TURSO_DATABASE_URL || 'file:local.db';

const ACTIONS = {
  emails: { description: 'vider la table "emails" (DELETE FROM emails)', sql: ['DELETE FROM emails'] },
  all: {
    description: 'supprimer les tables "events", "emails" et "rate_limits" (DROP TABLE)',
    sql: ['DROP TABLE IF EXISTS events', 'DROP TABLE IF EXISTS emails', 'DROP TABLE IF EXISTS rate_limits'],
  },
};

const action = ACTIONS[mode];
if (!action) {
  console.error('Usage : node scripts/purge.mjs <emails|all> [--yes]');
  process.exit(1);
}

console.log(`Base : ${target}`);
console.log(`Action : ${action.description}`);
if (!confirmed) {
  console.log('Rien n\'a été supprimé. Relance avec --yes pour confirmer (action irréversible).');
  process.exit(0);
}

const db = await getDb();
await db.batch(action.sql, 'write');
console.log('Terminé.');
