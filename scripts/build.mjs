// =====================================================================
//  BUILD DU SITE PUBLIC
//  node scripts/build.mjs  →  génère le dossier dist/ (servi par Vercel)
//
//  Étapes :
//   1. vérifie site.config.js et les fichiers de langue (arrêt si erreur) ;
//   2. copie public/, les polices et les images ;
//   3. bundle le JS (esbuild, Three.js dans un fichier séparé chargé plus tard)
//      et minifie le CSS ;
//   4. génère les 9 pages HTML (3 pages × 3 langues) à partir des gabarits ;
//   5. écrit assets/site-config.js (config publique, sans données sensibles).
// =====================================================================

import { build as esbuild, transform } from 'esbuild';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import siteConfig from '../site.config.js';
import { LANGS, DEFAULT_LANG } from '../src/shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'src', 'site');

// Mots interdits dans les textes (règles anti-dark-pattern du cahier des charges).
// Recherche insensible à la casse, dans toutes les langues.
// Attention : « stock » bloque aussi « stockée » → on écrit « conservée au sec ».
export const FORBIDDEN_WORDS = [
  'rupture',
  'stock',
  'plus que',
  'dernières',
  'countdown',
  'only left',
  'limited',
  'esaurit',
  'ultimi',
];

// Infos propres à chaque langue (hors textes) : préfixe d'URL et locale Open Graph.
// Pas de « / » final (vercel.json : trailingSlash false) : /en et non /en/, sinon redirection 308.
// Anglais britannique (en_GB, en-GB) : en.json est écrit en orthographe britannique.
const LANG_INFO = {
  fr: { prefix: '', ogLocale: 'fr_FR', intl: 'fr-FR' },
  en: { prefix: '/en', ogLocale: 'en_GB', intl: 'en-GB' },
  it: { prefix: '/it', ogLocale: 'it_IT', intl: 'it-IT' },
};

// Pages générées pour chaque langue : nom → fichier de sortie (relatif au dossier de la langue).
const PAGES = {
  home: { file: 'index.html', path: '' },
  privacy: { file: 'privacy.html', path: 'privacy' },
  legal: { file: 'legal.html', path: 'legal' },
};

// Polices copiées depuis node_modules vers dist/assets/fonts/
const FONT_FILES = [
  '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2',
  '@fontsource-variable/archivo/files/archivo-latin-ext-wdth-normal.woff2',
  '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
  '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2',
];

// ---------------------------------------------------------------------
//  1. Validation de la configuration
// ---------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function isValidDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  const d = new Date(str + 'T00:00:00Z');
  // « 2026-02-31 » devient le 3 mars : on vérifie que la date n'a pas « glissé ».
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

/** Vérifie site.config.js. Lève une erreur claire (en français) si quelque chose ne va pas. */
export function validateConfig(config) {
  const errors = [];
  if (!['random', 'schedule'].includes(config.PRICE_MODE)) {
    errors.push('PRICE_MODE doit valoir "random" ou "schedule".');
  }
  const prices = config.PRICES;
  if (!Array.isArray(prices) || prices.length === 0) {
    errors.push('PRICES doit contenir au moins un prix.');
  } else if (!prices.every((p) => typeof p === 'number' && Number.isFinite(p) && p > 0 && p < 100)) {
    errors.push('Chaque prix de PRICES doit être un nombre > 0 et < 100.');
  }
  if (!Array.isArray(config.PRICE_SCHEDULE)) {
    errors.push('PRICE_SCHEDULE doit être une liste.');
  } else {
    if (config.PRICE_MODE === 'schedule' && config.PRICE_SCHEDULE.length === 0) {
      errors.push('PRICE_SCHEDULE ne peut pas être vide en mode "schedule".');
    }
    for (const row of config.PRICE_SCHEDULE) {
      if (!row || !isValidDate(row.from)) errors.push(`PRICE_SCHEDULE : date invalide "${row && row.from}" (format AAAA-MM-JJ).`);
      if (!row || !Array.isArray(prices) || !prices.includes(row.price)) {
        errors.push(`PRICE_SCHEDULE : le prix ${row && row.price} doit figurer dans PRICES.`);
      }
    }
  }
  if (typeof config.CURRENCY !== 'string' || !/^[A-Z]{3}$/.test(config.CURRENCY)) {
    errors.push('CURRENCY doit être un code à 3 lettres (ex. "EUR").');
  }
  const q = config.QUESTIONNAIRE_URL;
  const qOk = (u) => u === '' || isHttpsUrl(u);
  const qValid =
    typeof q === 'string'
      ? qOk(q)
      : q !== null && typeof q === 'object' && !Array.isArray(q) &&
        LANGS.every((l) => typeof q[l] === 'string' && qOk(q[l])) &&
        Object.keys(q).every((k) => LANGS.includes(k));
  if (!qValid) {
    errors.push(`QUESTIONNAIRE_URL doit être '' ou une URL https://, ou un objet { ${LANGS.join(', ')} } de telles URL.`);
  }
  if (typeof config.CONTACT_EMAIL !== 'string' || !EMAIL_RE.test(config.CONTACT_EMAIL)) {
    errors.push('CONTACT_EMAIL n\'est pas une adresse e-mail valide.');
  }
  if (!isValidDate(config.DATA_DELETION_DATE)) {
    errors.push('DATA_DELETION_DATE doit être une date valide au format AAAA-MM-JJ.');
  }
  if (typeof config.SITE_URL !== 'string' || !isHttpUrl(config.SITE_URL)) {
    errors.push('SITE_URL doit être une URL complète en http:// ou https:// (ex. "https://upkap.vercel.app").');
  }
  if (typeof config.BRAND_NAME !== 'string' || config.BRAND_NAME.trim() === '') {
    errors.push('BRAND_NAME ne peut pas être vide.');
  }
  if (errors.length) throw new Error('Configuration invalide (site.config.js) :\n- ' + errors.join('\n- '));
}

function isHttpsUrl(str) {
  try {
    return new URL(str).protocol === 'https:';
  } catch {
    return false;
  }
}

function isHttpUrl(str) {
  try {
    return ['http:', 'https:'].includes(new URL(str).protocol);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
//  2. Validation des fichiers de langue
// ---------------------------------------------------------------------

/** Transforme {a:{b:'x'}} en {'a.b':'x'} (plus simple à comparer et à utiliser). */
export function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
    else out[full] = value;
  }
  return out;
}

/**
 * Vérifie que fr, en et it ont exactement les mêmes clés, toutes non vides,
 * et qu'aucun texte ne contient de mot interdit. Lève une erreur sinon.
 * @param {{fr:object, en:object, it:object}} locales
 */
export function validateLocales(locales) {
  const errors = [];
  const flat = {};
  for (const lang of LANGS) {
    if (!locales[lang] || typeof locales[lang] !== 'object') {
      errors.push(`Fichier de langue manquant : ${lang}.json`);
      continue;
    }
    flat[lang] = flatten(locales[lang]);
  }
  const allKeys = new Set(Object.values(flat).flatMap((f) => Object.keys(f)));
  for (const lang of Object.keys(flat)) {
    for (const key of allKeys) {
      const value = flat[lang][key];
      if (!(key in flat[lang])) errors.push(`${lang}.json : clé manquante "${key}"`);
      else if (typeof value !== 'string' || value.trim() === '') errors.push(`${lang}.json : texte vide ou invalide pour "${key}"`);
      else {
        const lower = value.toLowerCase();
        for (const word of FORBIDDEN_WORDS) {
          if (lower.includes(word)) errors.push(`${lang}.json : "${key}" contient le mot interdit "${word}"`);
        }
      }
    }
  }
  if (errors.length) throw new Error('Fichiers de langue invalides :\n- ' + errors.join('\n- '));
  return flat;
}

async function loadLocales() {
  const locales = {};
  for (const lang of LANGS) {
    const file = path.join(ROOT, 'locales', `${lang}.json`);
    locales[lang] = JSON.parse(await fs.readFile(file, 'utf8'));
  }
  return locales;
}

// ---------------------------------------------------------------------
//  3. Mini moteur de gabarits
//  {{cle}}        texte échappé (variable de build, sinon texte de la langue)
//  {{raw:nom}}    HTML préparé par le build (non échappé)
//  {{lines:cle}}  texte découpé en lignes animées (sauts de ligne \n)
//  {{md:cle}}     paragraphes et listes « - » (pages Confidentialité / Mentions)
// ---------------------------------------------------------------------

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Remplace {brand}, {contactEmail}, {deletionDate}, {publisher} dans un texte. */
function fillPlaceholders(text, values) {
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in values ? values[name] : m));
}

/** Échappe puis transforme les URL https et l'e-mail de contact en liens. */
function linkify(escaped, contactEmail) {
  let html = escaped.replace(/https:\/\/[^\s<]+[^\s<.,;:)]/g, (url) => `<a href="${url}" rel="noopener noreferrer">${url}</a>`);
  const mail = escapeHtml(contactEmail);
  html = html.split(mail).join(`<a href="mailto:${mail}">${mail}</a>`);
  return html;
}

function renderRich(text, contactEmail) {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => l.startsWith('- '))) {
        return '<ul>' + lines.map((l) => `<li>${linkify(escapeHtml(l.slice(2)), contactEmail)}</li>`).join('') + '</ul>';
      }
      return `<p>${lines.map((l) => linkify(escapeHtml(l), contactEmail)).join('<br>')}</p>`;
    })
    .join('\n');
}

function renderLines(text) {
  return text
    .split('\n')
    .map((line) => `<span class="line"><span class="line__in">${escapeHtml(line)}</span></span>`)
    .join(' ');
}

export function renderTemplate(tpl, ctx) {
  return tpl.replace(/\{\{\s*(?:(raw|lines|md):)?([\w.-]+)\s*\}\}/g, (match, filter, key) => {
    if (filter === 'raw') {
      if (!(key in ctx.vars)) throw new Error(`Gabarit : variable inconnue "${key}"`);
      return ctx.vars[key];
    }
    const text = key in ctx.vars ? String(ctx.vars[key]) : ctx.t(key);
    if (filter === 'lines') return renderLines(text);
    if (filter === 'md') return renderRich(text, ctx.contactEmail);
    return escapeHtml(text);
  });
}

// ---------------------------------------------------------------------
//  4. Image Open Graph (PNG 1200×630 généré sans dépendance)
// ---------------------------------------------------------------------

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Fond graphite + silhouette de bouteille + accent vert « volt ». */
export function makeOgPng(width = 1200, height = 630) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const bg = [11, 11, 12];
  const chalk = [238, 235, 227];
  const volt = [212, 255, 58];
  // Silhouette simplifiée de la bouteille (à droite)
  const cx = 860;
  const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return dx * dx + dy * dy <= r * r;
  };
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filtre PNG « None »
    for (let x = 0; x < width; x++) {
      let c = bg;
      let a = 0;
      // léger halo derrière la bouteille
      const d = Math.hypot(x - cx, y - 330) / 420;
      const glow = Math.max(0, 1 - d) * 0.09;
      let mix = [bg[0] + (chalk[0] - bg[0]) * glow, bg[1] + (chalk[1] - bg[1]) * glow, bg[2] + (chalk[2] - bg[2]) * glow];
      if (inRoundRect(x, y, cx - 95, 190, cx + 95, 560, 46)) {
        c = chalk;
        a = 0.16; // corps
        if (y > 330 && y < 430) a = 0.32; // étiquette
      }
      if (inRoundRect(x, y, cx - 52, 150, cx + 52, 200, 10)) { c = chalk; a = 0.24; } // goulot
      if (inRoundRect(x, y, cx - 60, 80, cx + 60, 152, 12)) { c = [26, 26, 28]; a = 1; } // bouchon
      if (inRoundRect(x, y, cx - 40, 66, cx + 40, 86, 8)) { c = volt; a = 1; } // bouton
      if (inRoundRect(x, y, 80, 470, 400, 486, 0)) { c = volt; a = 1; } // trait d'accent
      if (inRoundRect(x, y, 80, 150, 520, 186, 0) || inRoundRect(x, y, 80, 214, 460, 250, 0) || inRoundRect(x, y, 80, 278, 380, 314, 0)) {
        c = chalk; a = 0.85; // trois « lignes de titre » abstraites
      }
      if (a > 0) mix = [mix[0] + (c[0] - mix[0]) * a, mix[1] + (c[1] - mix[1]) * a, mix[2] + (c[2] - mix[2]) * a];
      const i = row + 1 + x * 3;
      raw[i] = Math.round(mix[0]);
      raw[i + 1] = Math.round(mix[1]);
      raw[i + 2] = Math.round(mix[2]);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------
//  5. Pages
// ---------------------------------------------------------------------

/** URL d'une page, sans « / » final : /, /privacy, /en, /en/privacy, /it… */
export function pageUrl(lang, page) {
  const path = PAGES[page].path;
  return LANG_INFO[lang].prefix + (path ? '/' + path : '') || '/';
}

function formatDate(isoDate, lang) {
  return new Intl.DateTimeFormat(LANG_INFO[lang].intl, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(isoDate + 'T00:00:00Z'));
}

async function renderPages({ outDir, config, locales, productSrc }) {
  const read = (name) => fs.readFile(path.join(SITE, 'templates', name), 'utf8');
  const tpl = {
    layout: await read('layout.html'),
    home: await read('home.html'),
    privacy: await read('privacy.html'),
    legal: await read('legal.html'),
    dialog: await read('dialog.html'),
  };
  const siteUrl = config.SITE_URL.replace(/\/+$/, '');

  for (const lang of LANGS) {
    const flat = flatten(locales[lang]);
    const placeholders = {
      brand: config.BRAND_NAME,
      contactEmail: config.CONTACT_EMAIL,
      publisher: config.PUBLISHER,
      director: config.PUBLICATION_DIRECTOR,
      deletionDate: formatDate(config.DATA_DELETION_DATE, lang),
    };
    const t = (key) => {
      if (!(key in flat)) throw new Error(`Texte manquant "${key}" (${lang}.json)`);
      return fillPlaceholders(flat[key], placeholders);
    };

    for (const page of Object.keys(PAGES)) {
      const alternates = [...LANGS, 'x-default']
        .map((l) => {
          const href = siteUrl + pageUrl(l === 'x-default' ? DEFAULT_LANG : l, page);
          return `<link rel="alternate" hreflang="${l}" href="${escapeHtml(href)}">`;
        })
        .join('\n  ');

      const langLinks = LANGS.map((l) => {
        const current = l === lang ? ' aria-current="true"' : '';
        // Accueil FR : « ?lang=fr » empêche la redirection automatique vers /en ou /it
        // (utile quand le localStorage est bloqué et ne peut pas mémoriser le choix).
        const href = l === DEFAULT_LANG && page === 'home' ? '/?lang=fr' : pageUrl(l, page);
        return `<a class="lang__link" href="${escapeHtml(href)}" hreflang="${l}" lang="${l}" data-lang-link="${l}"${current}>${l.toUpperCase()}</a>`;
      }).join('');

      const ogLocales = LANGS.filter((l) => l !== lang)
        .map((l) => `<meta property="og:locale:alternate" content="${LANG_INFO[l].ogLocale}">`)
        .join('\n  ');

      const vars = {
        lang,
        page,
        brand: config.BRAND_NAME,
        brandUpper: config.BRAND_NAME.toUpperCase(),
        contactEmail: config.CONTACT_EMAIL,
        mailto: 'mailto:' + config.CONTACT_EMAIL,
        year: String(new Date().getFullYear()),
        siteUrl,
        canonical: siteUrl + pageUrl(lang, page),
        ogImage: siteUrl + '/og.png',
        ogLocale: LANG_INFO[lang].ogLocale,
        homeHref: pageUrl(lang, 'home'),
        privacyHref: pageUrl(lang, 'privacy'),
        legalHref: pageUrl(lang, 'legal'),
        productSrc,
        metaTitle: t(`meta.${page}.title`),
        metaDescription: t(`meta.${page}.description`),
      };
      const ctx = { vars, t, contactEmail: config.CONTACT_EMAIL };
      vars.alternates = alternates;
      vars.ogLocaleAlternates = ogLocales;
      vars.langLinks = langLinks;
      vars.main = renderTemplate(tpl[page], ctx);
      vars.dialog = page === 'home' ? renderTemplate(tpl.dialog, ctx) : '';
      vars.headerAction =
        page === 'home'
          ? `<button class="btn btn--small" type="button" data-preorder>${escapeHtml(t('nav.preorder'))}</button>`
          : `<a class="btn btn--small btn--ghost" href="${escapeHtml(vars.homeHref)}">${escapeHtml(t('nav.back'))}</a>`;

      const html = renderTemplate(tpl.layout, ctx);
      const dir = path.join(outDir, lang === DEFAULT_LANG ? '' : lang);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, PAGES[page].file), html);
    }
  }
}

// ---------------------------------------------------------------------
//  6. Build complet
// ---------------------------------------------------------------------

/** Config publique lue par le navigateur : uniquement ce qui sert au prix et au questionnaire. */
function publicConfigModule(config) {
  const pub = {
    PRICE_MODE: config.PRICE_MODE,
    PRICES: config.PRICES,
    PRICE_SCHEDULE: config.PRICE_SCHEDULE,
    CURRENCY: config.CURRENCY,
    QUESTIONNAIRE_URL: config.QUESTIONNAIRE_URL,
    BRAND_NAME: config.BRAND_NAME,
  };
  return (
    '// Fichier généré par scripts/build.mjs : ne pas modifier à la main.\n' +
    Object.entries(pub)
      .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
      .join('\n') +
    '\n'
  );
}

export async function build({ outDir = process.env.BUILD_OUT_DIR || 'dist', config = siteConfig, quiet = false } = {}) {
  const started = Date.now();
  const out = path.resolve(ROOT, outDir);
  const assets = path.join(out, 'assets');

  validateConfig(config);
  const locales = await loadLocales();
  validateLocales(locales);

  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(assets, 'fonts'), { recursive: true });

  // public/ → racine de dist/ (robots.txt, favicon.svg, product.png, og.png…)
  const publicDir = path.join(ROOT, 'public');
  if (existsSync(publicDir)) await fs.cp(publicDir, out, { recursive: true });

  // Image Open Graph : celle de public/ si elle existe, sinon générée.
  if (!existsSync(path.join(publicDir, 'og.png'))) await fs.writeFile(path.join(out, 'og.png'), makeOgPng());

  // Visuel produit : public/product.png, sinon l'image de remplacement neutre.
  let productSrc = '/product.png';
  if (!existsSync(path.join(publicDir, 'product.png'))) {
    await fs.copyFile(path.join(SITE, 'img', 'product-placeholder.svg'), path.join(assets, 'product-placeholder.svg'));
    productSrc = '/assets/product-placeholder.svg';
  }

  for (const font of FONT_FILES) {
    await fs.copyFile(path.join(ROOT, 'node_modules', font), path.join(assets, 'fonts', path.basename(font)));
  }

  // CSS : un seul fichier, minifié.
  const css = await fs.readFile(path.join(SITE, 'css', 'site.css'), 'utf8');
  const cssMin = await transform(css, { loader: 'css', minify: true, target: ['chrome100', 'safari15', 'firefox100'] });
  await fs.writeFile(path.join(assets, 'site.css'), cssMin.code);

  // JS : main.js (léger, chargé tout de suite) + morceaux chargés à la demande (Three.js).
  await esbuild({
    entryPoints: [path.join(SITE, 'js', 'main.js')],
    outdir: assets,
    bundle: true,
    minify: true,
    format: 'esm',
    splitting: true,
    target: ['es2020'],
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
    external: ['/assets/site-config.js'],
    logLevel: 'warning',
  });

  await fs.writeFile(path.join(assets, 'site-config.js'), publicConfigModule(config));

  await renderPages({ outDir: out, config, locales, productSrc });

  // Tableau de bord admin (écrit par l'équipe backend), copié tel quel.
  const adminDir = path.join(ROOT, 'src', 'admin');
  if (existsSync(adminDir)) await fs.cp(adminDir, path.join(out, 'admin'), { recursive: true });

  if (!quiet) console.log(`Build terminé en ${Date.now() - started} ms → ${path.relative(ROOT, out) || out}`);
  return { outDir: out };
}

// Lancement direct : node scripts/build.mjs
const isMain = (() => {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
})();

if (isMain) {
  build().catch((err) => {
    console.error('\n✖ ' + err.message + '\n');
    process.exit(1);
  });
}
