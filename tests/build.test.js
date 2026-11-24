// Tests du build du site public (node --test tests/build.test.js)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build, validateConfig, validateLocales, pageUrl } from '../scripts/build.mjs';
import config from '../site.config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let outDir;

const PAGES = [
  ['fr', 'index.html'],
  ['fr', 'privacy.html'],
  ['fr', 'legal.html'],
  ['en', 'en/index.html'],
  ['en', 'en/privacy.html'],
  ['en', 'en/legal.html'],
  ['it', 'it/index.html'],
  ['it', 'it/privacy.html'],
  ['it', 'it/legal.html'],
];

const read = (rel) => fs.readFile(path.join(outDir, rel), 'utf8');
const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`));
  return m ? m[1] : null;
};

before(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dose-build-'));
  await build({ outDir, quiet: true });
});

after(async () => {
  if (outDir) await fs.rm(outDir, { recursive: true, force: true });
});

test('les 9 pages existent', async () => {
  for (const [, rel] of PAGES) {
    await assert.doesNotReject(fs.access(path.join(outDir, rel)), `page manquante : ${rel}`);
  }
});

test('chaque page a la bonne langue, les hreflang et des balises Open Graph complètes', async () => {
  const locales = { fr: 'fr_FR', en: 'en_GB', it: 'it_IT' };
  for (const [lang, rel] of PAGES) {
    const html = await read(rel);
    assert.match(html, new RegExp(`<html lang="${lang}"`), `${rel} : <html lang>`);
    for (const l of ['fr', 'en', 'it', 'x-default']) {
      assert.match(html, new RegExp(`<link rel="alternate" hreflang="${l}" href="https?://`), `${rel} : hreflang ${l}`);
    }
    assert.ok(meta(html, 'og:title'), `${rel} : og:title`);
    assert.ok(meta(html, 'og:description'), `${rel} : og:description`);
    assert.match(meta(html, 'og:image') || '', /^https?:\/\/[^/]+\/og\.png$/, `${rel} : og:image absolue`);
    assert.equal(meta(html, 'og:locale'), locales[lang], `${rel} : og:locale`);
    assert.match(meta(html, 'og:url') || '', /^https?:\/\//, `${rel} : og:url`);
    assert.ok(meta(html, 'twitter:card'), `${rel} : twitter:card`);
  }
});

test('les titres et descriptions Open Graph diffèrent selon la langue', async () => {
  for (const page of ['index.html', 'privacy.html', 'legal.html']) {
    const htmls = await Promise.all([read(page), read('en/' + page), read('it/' + page)]);
    const titles = new Set(htmls.map((h) => meta(h, 'og:title')));
    const descs = new Set(htmls.map((h) => meta(h, 'og:description')));
    assert.equal(titles.size, 3, `${page} : og:title identiques`);
    assert.equal(descs.size, 3, `${page} : og:description identiques`);
  }
});

test('compatibilité CSP : aucun script inline, aucun style="", aucun on*=', async () => {
  for (const [, rel] of PAGES) {
    const html = await read(rel);
    const scripts = html.match(/<script\b[^>]*>/gi) || [];
    for (const tag of scripts) assert.match(tag, /\ssrc="/, `${rel} : script inline interdit (${tag})`);
    assert.doesNotMatch(html, /\sstyle=/i, `${rel} : attribut style= interdit`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${rel} : attribut on*= interdit`);
    assert.doesNotMatch(html, /(src|href)="(https?:)?\/\/(?!localhost)[^"]*\.(js|css|woff2?)"/i, `${rel} : ressource externe`);
  }
});

test('formulaire : case de consentement non cochée et champ piège présent', async () => {
  for (const rel of ['index.html', 'en/index.html', 'it/index.html']) {
    const html = await read(rel);
    const box = html.match(/<input[^>]*name="consent"[^>]*>/);
    assert.ok(box, `${rel} : case de consentement absente`);
    assert.doesNotMatch(box[0], /checked/, `${rel} : la case ne doit pas être pré-cochée`);
    assert.match(box[0], /required/, `${rel} : la case doit être obligatoire`);
    const hp = html.match(/<input[^>]*name="website"[^>]*>/);
    assert.ok(hp, `${rel} : champ piège absent`);
    assert.match(hp[0], /tabindex="-1"/);
    assert.match(hp[0], /autocomplete="off"/);
    assert.match(html, /class="hp" aria-hidden="true"/);
  }
});

test('les textes exacts du cahier des charges sont présents (FR)', async () => {
  const html = await read('index.html');
  assert.ok(
    html.includes(
      'Ce produit est en cours de développement et n&#39;est pas encore en vente. Laisse ton e-mail pour être prévenu(e) du lancement.',
    ),
  );
  assert.ok(html.includes('J&#39;accepte d&#39;être contacté(e) au sujet du lancement. Mes données ne seront utilisées que pour ce projet étudiant et supprimées au plus tard le 30 juin 2027.'));
  assert.ok(html.includes('Projet étudiant ESCP Business School'));
});

test('validateLocales refuse une clé manquante ou un texte vide', () => {
  const ok = { fr: { a: 'x', b: { c: 'y' } }, en: { a: 'x', b: { c: 'y' } }, it: { a: 'x', b: { c: 'y' } } };
  assert.doesNotThrow(() => validateLocales(ok));
  assert.throws(() => validateLocales({ ...ok, en: { a: 'x', b: {} } }), /manquante/);
  assert.throws(() => validateLocales({ ...ok, it: { a: '', b: { c: 'y' } } }), /vide/);
  assert.throws(() => validateLocales({ ...ok, fr: { a: 'x', b: { c: 'y' }, extra: 'z' } }), /manquante/);
  assert.throws(() => validateLocales({ fr: ok.fr, en: ok.en }), /manquant/);
});

test('validateConfig refuse les configurations invalides', () => {
  assert.doesNotThrow(() => validateConfig(config));
  assert.throws(() => validateConfig({ ...config, PRICE_MODE: 'aleatoire' }), /PRICE_MODE/);
  assert.throws(() => validateConfig({ ...config, PRICES: [] }), /PRICES/);
  assert.throws(() => validateConfig({ ...config, PRICES: [0] }), /PRICES/);
  assert.throws(
    () => validateConfig({ ...config, PRICE_SCHEDULE: [{ from: '2026-11-16', price: 9.99 }] }),
    /PRICE_SCHEDULE/,
  );
  assert.throws(() => validateConfig({ ...config, QUESTIONNAIRE_URL: 'http://exemple.fr/q' }), /QUESTIONNAIRE_URL/);
  assert.doesNotThrow(() => validateConfig({ ...config, QUESTIONNAIRE_URL: 'https://exemple.fr/q' }));
  assert.doesNotThrow(() =>
    validateConfig({ ...config, QUESTIONNAIRE_URL: { fr: 'https://exemple.fr/fr', en: '', it: 'https://exemple.fr/it' } }),
  );
  assert.throws(() => validateConfig({ ...config, QUESTIONNAIRE_URL: { fr: 'https://exemple.fr/fr' } }), /QUESTIONNAIRE_URL/);
  assert.throws(
    () => validateConfig({ ...config, QUESTIONNAIRE_URL: { fr: '', en: '', it: '', de: 'https://exemple.fr' } }),
    /QUESTIONNAIRE_URL/,
  );
  assert.throws(() => validateConfig({ ...config, QUESTIONNAIRE_URL: { fr: 'javascript:alert(1)', en: '', it: '' } }), /QUESTIONNAIRE_URL/);
  assert.throws(() => validateConfig({ ...config, DATA_DELETION_DATE: '2027-02-31' }), /DATA_DELETION_DATE/);
  assert.throws(() => validateConfig({ ...config, DATA_DELETION_DATE: '30/06/2027' }), /DATA_DELETION_DATE/);
  assert.throws(
    () => validateConfig({ ...config, PRICE_SCHEDULE: [{ from: '2026-13-01', price: 2.5 }] }),
    /PRICE_SCHEDULE/,
  );
  assert.throws(() => validateConfig({ ...config, CONTACT_EMAIL: 'pas-un-email' }), /CONTACT_EMAIL/);
  assert.throws(() => validateConfig({ ...config, SITE_URL: 'exemple.fr' }), /SITE_URL/);
  assert.throws(() => validateConfig({ ...config, SITE_URL: 'javascript:alert(1)' }), /SITE_URL/);
  assert.doesNotThrow(() => validateConfig({ ...config, SITE_URL: 'https://exemple.vercel.app' }));
});

test('aucun mot de dark pattern dans les textes, dans aucune langue', async () => {
  const forbidden = ['rupture', 'stock', 'plus que', 'dernières', 'countdown', 'only left', 'limited', 'esaurit', 'ultimi'];
  for (const lang of ['fr', 'en', 'it']) {
    const text = (await fs.readFile(path.join(ROOT, 'locales', `${lang}.json`), 'utf8')).toLowerCase();
    for (const word of forbidden) assert.ok(!text.includes(word), `${lang}.json contient « ${word} »`);
  }
});

test('le JS principal reste léger (< 30 Ko gzip) et Three.js est séparé', async () => {
  const main = await fs.readFile(path.join(outDir, 'assets', 'main.js'));
  const gz = zlib.gzipSync(main).length;
  assert.ok(gz < 30 * 1024, `main.js fait ${gz} octets gzip`);
  assert.doesNotMatch(main.toString(), /WebGLRenderer/, 'Three.js ne doit pas être dans main.js');
  const chunks = await fs.readdir(path.join(outDir, 'assets', 'chunks'));
  assert.ok(chunks.length > 0, 'le morceau 3D doit être un fichier séparé');
});

test('site-config.js ne contient que la config publique', async () => {
  const js = await fs.readFile(path.join(outDir, 'assets', 'site-config.js'), 'utf8');
  for (const secret of ['CONTACT', 'PUBLISHER', 'DATA_DELETION', 'ADMIN_PASSWORD', 'APP_SECRET', 'TURSO', config.CONTACT_EMAIL]) {
    assert.ok(!js.includes(secret), `site-config.js contient « ${secret} »`);
  }
  for (const key of ['PRICE_MODE', 'PRICES', 'PRICE_SCHEDULE', 'CURRENCY', 'QUESTIONNAIRE_URL', 'BRAND_NAME']) {
    assert.match(js, new RegExp(`export const ${key} =`));
  }
});

test('fichiers annexes : og.png 1200×630, polices, robots.txt, favicon', async () => {
  const png = await fs.readFile(path.join(outDir, 'og.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const robots = await read('robots.txt');
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Disallow: \/api/);
  await fs.access(path.join(outDir, 'favicon.svg'));
  for (const font of ['archivo-latin-wdth-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2']) {
    await fs.access(path.join(outDir, 'assets', 'fonts', font));
  }
  // Tableau de bord copié depuis src/admin/ (servi à l'URL /admin)
  for (const file of ['index.html', 'admin.js', 'admin.css']) {
    await fs.access(path.join(outDir, 'admin', file));
  }
});

test('URL sans « / » final (vercel.json : trailingSlash false) dans canonical, hreflang et liens de langue', async () => {
  assert.equal(pageUrl('fr', 'home'), '/');
  assert.equal(pageUrl('fr', 'privacy'), '/privacy');
  assert.equal(pageUrl('en', 'home'), '/en');
  assert.equal(pageUrl('it', 'legal'), '/it/legal');
  for (const [, rel] of PAGES) {
    const html = await read(rel);
    const urls = [
      ...html.matchAll(/<link rel="(?:canonical|alternate)"[^>]*href="([^"]+)"/g),
      ...html.matchAll(/<meta property="og:url" content="([^"]+)"/g),
      ...html.matchAll(/class="lang__link" href="([^"]+)"/g),
    ].map((m) => m[1]);
    assert.ok(urls.length >= 9, `${rel} : URL introuvables`);
    for (const url of urls) {
      const { pathname } = new URL(url, 'http://x');
      assert.ok(pathname === '/' || !pathname.endsWith('/'), `${rel} : « / » final dans ${url}`);
    }
  }
  // Le lien FR de l'accueil empêche la redirection automatique (localStorage bloqué)
  assert.match(await read('en/index.html'), /class="lang__link" href="\/\?lang=fr"/);
});

test('SITE_URL est échappé dans les balises hreflang', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dose-build-url-'));
  try {
    await build({ outDir: dir, quiet: true, config: { ...config, SITE_URL: 'https://exemple.fr/a"b' } });
    const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
    assert.ok(html.includes('hreflang="en" href="https://exemple.fr/a&quot;b/en"'));
    assert.ok(!html.includes('a"b'), 'guillemet non échappé');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('page Confidentialité : boutons pour ne plus être mesuré, sans prétendre que la mesure est anonyme', async () => {
  for (const rel of ['privacy.html', 'en/privacy.html', 'it/privacy.html']) {
    const html = await read(rel);
    assert.match(html, /data-optout-stop/, `${rel} : bouton d'opposition absent`);
    assert.match(html, /data-optout-resume/, `${rel} : bouton de réactivation absent`);
    assert.match(html, /13/, `${rel} : durée de vie de l'identifiant absente`);
  }
  for (const lang of ['fr', 'en', 'it']) {
    const text = (await fs.readFile(path.join(ROOT, 'locales', `${lang}.json`), 'utf8')).toLowerCase();
    assert.ok(!/anonym|anonim/.test(text), `${lang}.json : la mesure n'est pas anonyme (identifiant pseudonyme)`);
  }
});

test('écran de remerciement : pas de « Précommande » (aucune commande passée)', async () => {
  const html = await read('index.html');
  const success = html.slice(html.indexOf('data-view="success"'));
  assert.ok(success.includes('Alerte lancement'));
  assert.ok(!success.includes('Précommande<'), 'le titre de succès ne doit pas évoquer une commande');
});

test('zones 3D : pas focusables dans le HTML (main.js les active seulement si la 3D tourne)', async () => {
  const html = await read('index.html');
  const zones = html.match(/<div class="stage[^>]*data-zone[^>]*>/g) || [];
  assert.equal(zones.length, 3);
  for (const z of zones) assert.doesNotMatch(z, /tabindex/, z);
});

test('mobile : la bouteille ne remonte plus sur le titre, cibles tactiles de 44 px, canvas dans son cadre', async () => {
  const css = await read('assets/site.css');
  // Toutes les déclarations des règles dont le sélecteur est exactement `sel`
  const rule = (sel) => {
    const out = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1].split(',').some((s) => s.trim() === sel)) out.push(m[2]);
    }
    return out.join(';');
  };
  assert.doesNotMatch(rule('.stage--hero'), /margin-top:\s*-/, '.stage--hero : pas de marge négative (elle faisait passer la bouteille sur le titre)');
  assert.match(rule('.lang__link'), /min-height:\s*44px/, '.lang__link : 44 px de haut au doigt');
  assert.match(rule('.reset'), /min-height:\s*44px/, '.reset : 44 px de haut');
  assert.match(rule('.footer__nav a'), /min-height:\s*44px/, 'liens du pied de page : 44 px de haut');
  assert.match(css, /\.btn--small\s*\{[^}]*min-height:\s*44px/, '.btn--small : 44 px au doigt');
  for (const [, rel] of PAGES) {
    const html = await read(rel);
    assert.match(html, /<div class="gl-wrap"[^>]*>\s*<canvas class="gl"/, `${rel} : le canvas est dans .gl-wrap`);
  }
  // Écrans très hauts (téléphone en « version ordinateur », 980 x 2177) : aucun espacement
  // proportionnel à la hauteur sans borne, sinon des trous énormes entre les sections.
  for (const m of css.matchAll(/(padding|margin)(-top|-bottom)?:([^;}]*)/g)) {
    const value = m[3].replace(/clamp\([^()]*(\([^()]*\)[^()]*)*\)/g, '');
    assert.doesNotMatch(value, /\d(s|d|l)?vh/, `${m[0].trim()} : espacement en vh non borné (utiliser clamp)`);
  }
  // « Pour qui » : deux colonnes seulement à partir de 1100 px, 1re colonne = largeur du mot.
  assert.match(css, /grid-template-columns:\s*max-content minmax\(18ch,\s*1fr\)/);
});

test('les grands mots de fond suivent la longueur du nom de marque', async () => {
  const css = await fs.readFile(path.join(outDir, 'assets', 'site.css'), 'utf8');
  const fit = Math.min(1, 5 / [...config.BRAND_NAME].length);
  assert.ok(css.startsWith(`:root{--brand-fit:${String(Number(fit.toFixed(3))).replace(/^0\./, '.')}}`), css.slice(0, 40));
  const src = await fs.readFile(path.join(ROOT, 'src', 'site', 'css', 'site.css'), 'utf8');
  for (const cls of ['.hero__ghost', '.final__ghost', '.footer__brand']) {
    const block = src.slice(src.indexOf(`${cls} {`), src.indexOf('}', src.indexOf(`${cls} {`)));
    assert.match(block, /font-size: calc\(\d+vw \* var\(--brand-fit, 1\)\)/, cls);
  }
  // Le logo de l'en-tête ne doit jamais s'écraser à côté d'un nom long.
  assert.match(src, /\.wordmark__mark \{\s*flex-shrink: 0;/);
});
