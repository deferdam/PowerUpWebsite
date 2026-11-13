// POST /api/admin/logout : efface le cookie de session.
import { clearSessionCookie, requireAdminConfigured } from '../../lib/auth.js';
import { handler, noContent, readJsonPost } from '../../lib/http.js';

export const POST = handler(async (request) => {
  requireAdminConfigured();
  await readJsonPost(request, []); // mêmes contrôles que les autres POST (origine, type, taille)
  return noContent({ 'set-cookie': clearSessionCookie() });
});
