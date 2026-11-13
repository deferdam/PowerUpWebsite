// Outils HTTP communs aux fonctions /api : réponses JSON, erreurs, contrôles des POST, IP du client.
import { MAX_BODY_BYTES } from '../src/shared/constants.js';

/** Erreur « attendue » : renvoyée au client sous la forme {"error": code}, sans détail interne. */
export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Réponse JSON, jamais mise en cache. */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/** Réponse d'erreur : {"error":"code_court"}. */
export function errorResponse(code, status) {
  return json({ error: code }, status);
}

/** Réponse vide (204). */
export function noContent(headers = {}) {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...headers } });
}

/**
 * Enveloppe un handler : une HttpError devient une réponse propre,
 * toute autre erreur devient un 500 générique (le détail reste dans les logs serveur).
 */
export function handler(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.code, err.status);
      console.error('[api] erreur interne :', err);
      return errorResponse('internal_error', 500);
    }
  };
}

/** IP du client : x-real-ip, sinon le 1er élément de x-forwarded-for, sinon "unknown". */
export function clientIp(request) {
  const realIp = (request.headers.get('x-real-ip') || '').trim();
  if (realIp) return realIp;
  const first = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return first || 'unknown';
}

/** 1. Origine : même host que l'URL de la requête, ou Sec-Fetch-Site: same-origin s'il n'y a pas d'Origin. */
function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'forbidden_origin'); // par exemple « Origin: null »
    }
    if (originHost !== new URL(request.url).host) throw new HttpError(403, 'forbidden_origin');
    return;
  }
  if (request.headers.get('sec-fetch-site') !== 'same-origin') throw new HttpError(403, 'forbidden_origin');
}

/** 2. Content-Type : application/json (le paramètre charset est toléré). */
function checkContentType(request) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported_media_type');
}

/** 3. Taille : en-tête content-length, puis lecture morceau par morceau avec arrêt dès que la limite est dépassée. */
async function readLimitedText(request, maxBytes) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) throw new HttpError(413, 'payload_too_large');
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'payload_too_large');
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new HttpError(400, 'invalid_json'); // octets qui ne forment pas de l'UTF-8 valide
  }
}

/**
 * Contrôles communs à tout POST, dans l'ordre du contrat (docs/SPEC.md) :
 * origine (403), Content-Type (415), taille (413), JSON objet simple (400), liste blanche (400).
 * @param {Request} request
 * @param {string[]} allowedKeys clés autorisées dans le corps
 * @returns {Promise<Record<string, unknown>>} le corps décodé
 */
export async function readJsonPost(request, allowedKeys) {
  checkOrigin(request);
  checkContentType(request);
  const text = await readLimitedText(request, MAX_BODY_BYTES);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_json');

  for (const key of Object.keys(body)) {
    if (!allowedKeys.includes(key)) throw new HttpError(400, 'unknown_field');
  }
  return body;
}
