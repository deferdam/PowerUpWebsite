// Limitation du nombre de requêtes par IP, stockée en base (fenêtres fixes).
// L'IP n'est JAMAIS stockée en clair : seulement HMAC-SHA256(secret, "ip:" + ip + ":" + bucket).
import { createHmac } from 'node:crypto';
import { getDb } from './db.js';
import { clientIp, HttpError } from './http.js';
import { rateLimitSecret } from './auth.js';

const ONE_DAY_MS = 24 * 3600 * 1000;

/**
 * Compte une requête de plus pour cette IP dans ce « bucket » ; erreur 429 au-delà de `limit`.
 * @param {Request} request
 * @param {string} bucket   par exemple "event", "email", "login"
 * @param {number} limit    nombre de requêtes autorisées par fenêtre
 * @param {number} windowMs durée de la fenêtre en millisecondes
 */
export async function enforceRateLimit(request, bucket, limit, windowMs) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = createHmac('sha256', rateLimitSecret()).update(`ip:${clientIp(request)}:${bucket}`).digest('hex');

  const db = await getDb();
  const result = await db.execute({
    sql: `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
          ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
          RETURNING count`,
    args: [key, windowStart],
  });

  // Ménage occasionnel (environ 1 appel sur 100) : suppression des fenêtres de plus d'un jour.
  if (Math.random() < 0.01) {
    await db.execute({ sql: 'DELETE FROM rate_limits WHERE window_start < ?', args: [now - ONE_DAY_MS] });
  }

  if (Number(result.rows[0].count) > limit) throw new HttpError(429, 'too_many_requests');
}
