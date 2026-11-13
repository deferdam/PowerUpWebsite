// GET /api/admin/export-emails : la liste des e-mails (avec consentement) en CSV.
import { requireAdmin } from '../../lib/auth.js';
import { csvResponse, toCsv } from '../../lib/csv.js';
import { getDb } from '../../lib/db.js';
import { handler } from '../../lib/http.js';

const HEADER = ['email', 'lang', 'consent_at', 'created_at'];

export const GET = handler(async (request) => {
  requireAdmin(request);
  const db = await getDb();
  const result = await db.execute('SELECT email, lang, consent_at, created_at FROM emails ORDER BY id');
  const rows = result.rows.map((r) => [r.email, r.lang, r.consent_at, r.created_at]);
  return csvResponse('emails.csv', toCsv(HEADER, rows));
});
