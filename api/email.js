// POST /api/email : enregistre l'e-mail d'un visiteur qui a donné son consentement.
// L'adresse va dans la table "emails" (sans identifiant visiteur ni prix) ;
// la table "events" reçoit seulement un événement "email_soumis", sans l'adresse,
// et seulement pour un visiteur déjà compté (qui a un "page_vue").
import config from '../site.config.js';
import { priceFor } from '../src/shared/pricing.js';
import { getDb } from '../lib/db.js';
import { handler, HttpError, json, readJsonPost } from '../lib/http.js';
import { enforceRateLimit } from '../lib/ratelimit.js';
import { isLang, isUuidV4, normalizeEmail, readUtm } from '../lib/validate.js';

const ALLOWED_KEYS = ['email', 'consent', 'website', 'visitorId', 'lang', 'utm_source', 'utm_medium', 'utm_campaign'];

export const POST = handler(async (request) => {
  const body = await readJsonPost(request, ALLOWED_KEYS);
  await enforceRateLimit(request, 'email', 5, 10 * 60 * 1000); // 5 envois par tranche de 10 minutes et par IP

  // Champ piège (honeypot) : invisible pour un humain, rempli par les robots. On fait semblant d'accepter.
  if (body.website !== undefined && body.website !== null && body.website !== '') return json({ ok: true });

  if (body.consent !== true) throw new HttpError(400, 'consent_required'); // la chaîne "true" est refusée
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, 'invalid_email');
  if (!isUuidV4(body.visitorId)) throw new HttpError(400, 'invalid_visitor_id');
  if (!isLang(body.lang)) throw new HttpError(400, 'invalid_lang');

  const now = new Date();
  const nowIso = now.toISOString();
  const { priceCents, mode } = priceFor(config, body.visitorId, now);
  const utm = readUtm(body);

  const db = await getDb();
  // Une seule transaction pour les deux écritures.
  await db.batch(
    [
      {
        // Doublon : rien n'est écrit et la réponse est identique (impossible de savoir si l'adresse existait).
        sql: 'INSERT INTO emails (email, lang, consent_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING',
        // Dates arrondies au jour : empêche de relier une adresse à l'historique d'un visiteur
        // en joignant sur l'horodatage exact de l'événement email_soumis.
        args: [email, body.lang, nowIso.slice(0, 10), nowIso.slice(0, 10)],
      },
      {
        // Un seul "email_soumis" par visiteur, et seulement si ce visiteur a un "page_vue".
        // Un membre de l'équipe en opt-out (?interne=1) n'envoie aucun page_vue : son test du formulaire
        // enregistre l'adresse mais ne doit pas gonfler la conversion (e-mails / visiteurs) dans les stats.
        sql: `INSERT INTO events (ts, visitor_id, event, lang, price_cents, price_mode, source, utm_source, utm_medium, utm_campaign)
              SELECT ?, ?, 'email_soumis', ?, ?, ?, ?, ?, ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM events WHERE visitor_id = ? AND event = 'email_soumis')
                AND EXISTS (SELECT 1 FROM events WHERE visitor_id = ? AND event = 'page_vue')`,
        args: [
          nowIso,
          body.visitorId,
          body.lang,
          priceCents,
          mode,
          utm.source,
          utm.utm_source,
          utm.utm_medium,
          utm.utm_campaign,
          body.visitorId,
          body.visitorId,
        ],
      },
    ],
    'write',
  );
  return json({ ok: true });
});
