// Validation des champs envoyés par le navigateur. Fonctions pures, sans accès à la base.
import { CLIENT_EVENTS, LANGS, MAX_EMAIL_LENGTH, UTM_RE, UUID_V4_RE } from '../src/shared/constants.js';

export const EMAIL_RE =
  /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function isUuidV4(value) {
  return typeof value === 'string' && UUID_V4_RE.test(value);
}

export function isLang(value) {
  return typeof value === 'string' && LANGS.includes(value);
}

/** Événements acceptés par /api/event (email_soumis n'en fait PAS partie). */
export function isClientEvent(value) {
  return typeof value === 'string' && CLIENT_EVENTS.includes(value);
}

/**
 * UTM : minuscules, 64 caractères maximum, puis UTM_RE.
 * Valeur invalide => null (pas d'erreur : les liens UTM sont tapés à la main).
 */
export function normalizeUtm(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().slice(0, 64);
  return UTM_RE.test(v) ? v : null;
}

/** Les trois UTM validés + la source ("direct" s'il n'y a pas d'utm_source valide). */
export function readUtm(body) {
  const utm_source = normalizeUtm(body.utm_source);
  const utm_medium = normalizeUtm(body.utm_medium);
  const utm_campaign = normalizeUtm(body.utm_campaign);
  return { utm_source, utm_medium, utm_campaign, source: utm_source || 'direct' };
}

/** E-mail : trim + minuscules, 254 caractères max, EMAIL_RE. Renvoie l'adresse normalisée ou null. */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_RE.test(email) ? email : null;
}
