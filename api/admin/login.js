// POST /api/admin/login : vérifie le mot de passe et pose le cookie de session signé.
import { checkPassword, requireAdminConfigured, sessionCookie } from '../../lib/auth.js';
import { handler, HttpError, noContent, readJsonPost } from '../../lib/http.js';
import { enforceRateLimit } from '../../lib/ratelimit.js';

export const POST = handler(async (request) => {
  requireAdminConfigured(); // 503 si ADMIN_PASSWORD (12 caractères min.) ou APP_SECRET manque
  const body = await readJsonPost(request, ['password']);
  await enforceRateLimit(request, 'login', 5, 15 * 60 * 1000); // 5 tentatives par 15 minutes et par IP

  if (!checkPassword(body.password)) throw new HttpError(401, 'unauthorized');
  return noContent({ 'set-cookie': sessionCookie() });
});
