// POST /api/event : enregistre un événement envoyé par le navigateur (page_vue, clic_precommande, clic_questionnaire).
import config from '../site.config.js';
import { priceFor } from '../src/shared/pricing.js';
import { getDb } from '../lib/db.js';
import { handler, HttpError, noContent, readJsonPost } from '../lib/http.js';
import { enforceRateLimit } from '../lib/ratelimit.js';
import { isClientEvent, isLang, isUuidV4, readUtm } from '../lib/validate.js';

// Liste blanche : toute autre clé (par exemple "price") donne une erreur 400.
const ALLOWED_KEYS = ['visitorId', 'event', 'lang', 'utm_source', 'utm_medium', 'utm_campaign'];

export const POST = handler(async (request) => {
  const body = await readJsonPost(request, ALLOWED_KEYS);
  await enforceRateLimit(request, 'event', 60, 60 * 1000); // 60 requêtes par minute et par IP

  if (!isUuidV4(body.visitorId)) throw new HttpError(400, 'invalid_visitor_id');
  if (!isClientEvent(body.event)) throw new HttpError(400, 'invalid_event'); // email_soumis refusé ici
  if (!isLang(body.lang)) throw new HttpError(400, 'invalid_lang');

  // Le prix est TOUJOURS recalculé côté serveur : on ne fait jamais confiance au navigateur.
  const now = new Date();
  const { priceCents, mode } = priceFor(config, body.visitorId, now);
  const utm = readUtm(body);

  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO events (ts, visitor_id, event, lang, price_cents, price_mode, source, utm_source, utm_medium, utm_campaign)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      now.toISOString(),
      body.visitorId,
      body.event,
      body.lang,
      priceCents,
      mode,
      utm.source,
      utm.utm_source,
      utm.utm_medium,
      utm.utm_campaign,
    ],
  });
  return noContent();
});
