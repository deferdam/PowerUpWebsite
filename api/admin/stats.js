// GET /api/admin/stats : indicateurs par prix et par source (JSON), réservé à l'équipe connectée.
import config from '../../site.config.js';
import { requireAdmin } from '../../lib/auth.js';
import { handler, json } from '../../lib/http.js';
import { computeStats } from '../../lib/stats.js';

export const GET = handler(async (request) => {
  requireAdmin(request);
  return json(await computeStats(config.PRICE_MODE));
});
