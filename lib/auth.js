// Authentification du tableau de bord : mot de passe (variable d'environnement) + cookie signé.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

export const COOKIE_NAME = '__Host-pu_admin';
export const SESSION_MAX_AGE_S = 8 * 3600; // 8 heures

// Secret aléatoire propre à ce processus : utilisé seulement si APP_SECRET manque.
const processSecret = randomBytes(32).toString('hex');
let warned = false;

/** Vrai sur Vercel (production ou preview) ou si NODE_ENV=production. */
export function isProduction() {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
}

/** APP_SECRET s'il est valable (32 caractères minimum), sinon null (avec un avertissement en dev). */
export function getAppSecret() {
  const secret = process.env.APP_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (!isProduction() && !warned) {
    warned = true;
    console.warn('[sécurité] APP_SECRET absent ou trop court (32 caractères min.) : secret aléatoire temporaire utilisé.');
  }
  return null;
}

/** Secret pour le HMAC des IP : APP_SECRET, sinon le secret aléatoire du processus. */
export function rateLimitSecret() {
  return getAppSecret() || processSecret;
}

/** Secret du cookie admin. En production sans APP_SECRET : null (les routes admin répondent alors 503). */
function sessionSecret() {
  return getAppSecret() || (isProduction() ? null : processSecret);
}

/** Lance une erreur 503 si l'admin n'est pas configuré (mot de passe < 12 caractères ou secret manquant). */
export function requireAdminConfigured() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12 || !sessionSecret()) throw new HttpError(503, 'admin_disabled');
}

function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest();
}

/** Comparaison en temps constant : on compare les empreintes SHA-256 (toujours 32 octets). */
export function checkPassword(candidate) {
  if (typeof candidate !== 'string') return false;
  return timingSafeEqual(sha256(candidate), sha256(process.env.ADMIN_PASSWORD || ''));
}

function sign(expMs) {
  return createHmac('sha256', sessionSecret()).update(`session:${expMs}`).digest('base64url');
}

/** Valeur du cookie : "<date d'expiration en ms>.<signature HMAC base64url>". */
export function makeSessionValue(expMs) {
  return `${expMs}.${sign(expMs)}`;
}

/** En-tête Set-Cookie après une connexion réussie. */
export function sessionCookie(now = Date.now()) {
  const value = makeSessionValue(now + SESSION_MAX_AGE_S * 1000);
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_S}`;
}

/** En-tête Set-Cookie qui efface le cookie (déconnexion). */
export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Vrai si le cookie est présent, correctement signé et non expiré. */
export function isSessionValid(request, now = Date.now()) {
  const value = readCookie(request, COOKIE_NAME);
  if (!value) return false;
  const match = /^(\d{1,16})\.([A-Za-z0-9_-]{1,100})$/.exec(value);
  if (!match) return false;

  const expMs = Number(match[1]);
  const given = Buffer.from(match[2]);
  const expected = Buffer.from(sign(expMs));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  return expMs > now;
}

/** Au début de chaque route admin protégée : 503 si non configuré, 401 sans session valide. */
export function requireAdmin(request) {
  requireAdminConfigured();
  if (!isSessionValid(request)) throw new HttpError(401, 'unauthorized');
}
