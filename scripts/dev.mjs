// Serveur de développement local : `npm run dev` puis http://localhost:3000
// - lance le build (scripts/build.mjs) puis sert le dossier dist/ ;
// - applique les en-têtes de vercel.json (on teste donc la CSP en local) et les « cleanUrls » ;
// - envoie /api/... vers les fonctions du dossier api/ (exports GET / POST au format Web standard).
// Sécurité : le serveur n'écoute que sur 127.0.0.1 (invisible depuis le réseau) et refuse tout en-tête Host
// qui n'est pas localhost:<port> ou 127.0.0.1:<port> (protection contre le « DNS rebinding »).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const MAX_API_BODY = 1024 * 1024; // le contrôle fin (2 Ko) est fait par les fonctions elles-mêmes

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.glb': 'model/gltf-binary',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Transforme le chemin d'une URL en chemin de fichier DANS `distDir`, ou null s'il en sortirait.
 * Refuse « .. », sa version encodée (%2e%2e), les antislashs et les octets nuls.
 * @param {string} distDir dossier racine (absolu)
 * @param {string} urlPath chemin brut de l'URL, par exemple "/en/privacy"
 */
export function resolveStaticPath(distDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null; // encodage invalide
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.split('/').includes('..')) return null;

  const root = path.resolve(distDir);
  const resolved = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** cleanUrls : /privacy -> privacy.html, /en -> en/index.html, / -> index.html. */
async function findStaticFile(urlPath) {
  const base = resolveStaticPath(DIST, urlPath);
  if (!base) return null;
  const candidates = [base, base + '.html', path.join(base, 'index.html')];
  for (const candidate of candidates) {
    // Pour « / », base + '.html' donnerait « dist.html », hors de dist/ : on revérifie donc chaque candidat.
    if (candidate.startsWith(DIST + path.sep) && (await isFile(candidate))) return candidate;
  }
  return null;
}

/**
 * Vrai si l'en-tête Host désigne bien ce serveur local : "localhost:<port>" ou "127.0.0.1:<port>".
 * Une page malveillante qui ferait pointer son propre nom de domaine vers 127.0.0.1 (DNS rebinding)
 * enverrait « Host: evil.example:3000 » : refusé, donc pas d'écriture dans la base configurée dans .env.
 * @param {string | undefined} host valeur brute de l'en-tête Host
 * @param {number} port port d'écoute du serveur
 */
export function isLocalHost(host, port) {
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}

/** Convertit un motif "source" de vercel.json (ex. "/api/(.*)") en expression régulière. */
function sourceToRegExp(source) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + source.split('(.*)').map(escape).join('(.*)') + '$');
}

function loadVercelHeaders() {
  const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  return (vercel.headers || []).map((rule) => ({ re: sourceToRegExp(rule.source), headers: rule.headers }));
}

/** En-têtes vercel.json qui s'appliquent à ce chemin (les règles suivantes complètent les précédentes). */
function headersFor(rules, pathname) {
  const out = {};
  for (const rule of rules) {
    if (rule.re.test(pathname)) for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

function readNodeBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_API_BODY) {
        reject(new Error('too_large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Appelle la fonction api/....js correspondante en convertissant node:http <-> Request/Response. */
async function handleApi(req, res, url, extraHeaders) {
  const segments = url.pathname.split('/').slice(2); // ["admin", "login"]
  if (segments.length === 0 || !segments.every((s) => /^[a-z0-9-]+$/.test(s))) {
    return send(res, 404, extraHeaders, '{"error":"not_found"}', 'application/json; charset=utf-8');
  }
  const file = path.join(ROOT, 'api', ...segments) + '.js';
  if (!existsSync(file)) return send(res, 404, extraHeaders, '{"error":"not_found"}', 'application/json; charset=utf-8');

  const mod = await import(pathToFileURL(file).href);
  const fn = req.method === 'GET' || req.method === 'POST' ? mod[req.method] : undefined;
  if (typeof fn !== 'function') {
    return send(res, 405, extraHeaders, '{"error":"method_not_allowed"}', 'application/json; charset=utf-8');
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  // Comme sur Vercel : l'IP vient de la connexion, pas d'un en-tête envoyé par le client.
  headers.delete('x-real-ip');
  headers.set('x-forwarded-for', req.socket.remoteAddress || 'unknown');

  let body;
  if (req.method === 'POST') {
    try {
      body = await readNodeBody(req);
    } catch {
      return send(res, 413, extraHeaders, '{"error":"payload_too_large"}', 'application/json; charset=utf-8');
    }
  }

  // req.headers.host a déjà été vérifié par isLocalHost : l'URL reste locale (et le contrôle d'Origin de lib/http.js fiable).
  const request = new Request(new URL(req.url, `http://${req.headers.host}`), { method: req.method, headers, body });
  const response = await fn(request);

  const outHeaders = { ...extraHeaders };
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') outHeaders[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) outHeaders['set-cookie'] = cookies;
  res.writeHead(response.status, outHeaders);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function send(res, status, headers, body, contentType) {
  res.writeHead(status, { ...headers, 'content-type': contentType });
  res.end(body);
}

async function handleStatic(req, res, url, extraHeaders) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, extraHeaders, 'Method Not Allowed', 'text/plain');

  // cleanUrls : comme Vercel, /page.html redirige vers /page et /index.html vers /
  if (url.pathname.endsWith('.html')) {
    const clean = url.pathname.replace(/(\/index)?\.html$/, '') || '/';
    res.writeHead(308, { ...extraHeaders, location: clean + url.search });
    return res.end();
  }

  const file = await findStaticFile(url.pathname);
  if (!file) {
    const notFound = path.join(DIST, '404.html');
    const page = (await isFile(notFound)) ? await readFile(notFound) : 'Page introuvable';
    return send(res, 404, extraHeaders, page, 'text/html; charset=utf-8');
  }
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { ...extraHeaders, 'content-type': type });
  res.end(req.method === 'HEAD' ? undefined : await readFile(file));
}

function runBuild() {
  const buildScript = path.join(ROOT, 'scripts', 'build.mjs');
  if (!existsSync(buildScript)) {
    console.warn('[dev] scripts/build.mjs introuvable : pas de build, on sert dist/ tel quel.');
    return;
  }
  const result = spawnSync(process.execPath, [buildScript], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('[dev] le build a échoué, corrige les erreurs ci-dessus.');
    process.exit(1);
  }
}

function main() {
  const envFile = path.join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.ADMIN_PASSWORD) console.warn('[dev] ADMIN_PASSWORD absent : /admin restera fermé (voir .env.example).');

  runBuild();
  const rules = loadVercelHeaders();
  const port = Number(process.env.PORT) || 3000;

  const server = createServer(async (req, res) => {
    // DNS rebinding ou client du réseau qui forge l'en-tête Host : refusé avant tout traitement.
    if (!isLocalHost(req.headers.host, port)) return send(res, 400, {}, 'Host non autorisé', 'text/plain; charset=utf-8');
    try {
      const url = new URL(req.url, 'http://localhost');
      const extraHeaders = headersFor(rules, url.pathname);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await handleApi(req, res, url, extraHeaders);
      else await handleStatic(req, res, url, extraHeaders);
    } catch (err) {
      console.error('[dev] erreur :', err);
      if (!res.headersSent) send(res, 500, {}, 'Erreur interne', 'text/plain; charset=utf-8');
      else res.end();
    }
  });
  // 127.0.0.1 uniquement : le serveur de dev n'est pas joignable depuis les autres machines du réseau.
  server.listen(port, '127.0.0.1', () => console.log(`[dev] site local : http://localhost:${port}  (admin : http://localhost:${port}/admin)`));
}

// On ne démarre le serveur que si le fichier est lancé directement (pas quand un test l'importe).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
