// GET /api/admin/export-events : tous les événements en CSV. AUCUN e-mail dans ce fichier.
import { requireAdmin } from '../../lib/auth.js';
import { csvResponse, toCsv } from '../../lib/csv.js';
import { getDb } from '../../lib/db.js';
import { handler } from '../../lib/http.js';

const HEADER = ['ts', 'visitor_id', 'event', 'lang', 'price', 'price_mode', 'source', 'utm_source', 'utm_medium', 'utm_campaign'];

export const GET = handler(async (request) => {
  requireAdmin(request);
  const db = await getDb();
  const result = await db.execute(
    `SELECT ts, visitor_id, event, lang, price_cents, price_mode, source, utm_source, utm_medium, utm_campaign
     FROM events ORDER BY id`,
  );
  const rows = result.rows.map((r) => [
    r.ts,
    r.visitor_id,
    r.event,
    r.lang,
    (Number(r.price_cents) / 100).toFixed(2), // prix en euros, par exemple 3.50
    r.price_mode,
    r.source,
    r.utm_source,
    r.utm_medium,
    r.utm_campaign,
  ]);
  return csvResponse('events.csv', toCsv(HEADER, rows));
});
