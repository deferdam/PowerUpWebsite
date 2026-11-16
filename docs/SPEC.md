# Spécification technique (contrat commun)

Site « fake door test » pour un projet étudiant ESCP. Il mesure l'intention d'achat d'une boisson prête à boire dont le bouchon contient 3 à 5 g de créatine stockée au sec : on appuie sur le bouchon, la poudre tombe, on secoue, on boit. Le site ne vend rien, n'encaisse rien et ne trompe personne.

Déjà écrits (ne pas réécrire sans raison, mais tu peux corriger un bug) : `package.json`, `site.config.js`, `src/shared/pricing.js`, `src/shared/constants.js`, `vercel.json`, `.gitignore`, `.env.example`. Les dépendances sont déjà installées, **ne lance pas `npm install`** : `@libsql/client` (runtime), `three`, `esbuild`, `@fontsource-variable/archivo`, `@fontsource/jetbrains-mono` (dev). Node 24, ESM partout (`"type": "module"`). **Aucune autre dépendance.**

## Arborescence et propriétaires

```
site.config.js            config unique (marque, prix, mode, calendrier, questionnaire, contact, date de suppression)
src/shared/               pricing.js + constants.js, importables navigateur ET serveur
lib/                      [BACKEND] serveur uniquement : db.js, http.js, validate.js, ratelimit.js, auth.js, csv.js, stats.js
api/                      [BACKEND] fonctions Vercel : event.js, email.js, admin/{login,logout,stats,export-events,export-emails}.js
src/admin/                [BACKEND] index.html, admin.js, admin.css (tableau de bord), copiés tels quels par le build vers dist/admin/
scripts/dev.mjs           [BACKEND] serveur local
scripts/purge.mjs         [BACKEND] suppression des données
scripts/build.mjs         [FRONTEND] génère dist/
locales/{fr,en,it}.json   [FRONTEND] tous les textes du site public
src/site/                 [FRONTEND] gabarits HTML, CSS, JS, scène 3D
public/                   [FRONTEND] fichiers statiques copiés à la racine de dist/ (product.png si présent, robots.txt, favicon…)
tests/                    les deux : backend-*.test.js (BACKEND), build.test.js (FRONTEND)
dist/                     généré, ignoré par git
```

Un agent ne modifie jamais les fichiers de l'autre propriétaire.

## Variables d'environnement (jamais dans le code)

- `ADMIN_PASSWORD` : si absent ou moins de 12 caractères, `/api/admin/*` répond 503 et la connexion est impossible.
- `APP_SECRET` (32 caractères minimum) : signe le cookie admin et sert au HMAC des IP (avec des libellés différents, par exemple `HMAC(APP_SECRET, "ip:" + ...)` et `HMAC(APP_SECRET, "session:" + ...)`). S'il manque : en production, les routes admin répondent 503 et le rate limit utilise un secret aléatoire par processus ; en dev, un avertissement est affiché.
- `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` : si l'URL est vide, `file:local.db` est utilisé. Les tests utilisent `:memory:`.

## Fonctions Vercel (format Web standard)

Chaque fichier `api/**.js` exporte des fonctions nommées `GET` et/ou `POST`, de signature `(request: Request) => Promise<Response>`. C'est le format « Web handlers » du runtime Node de Vercel. Pas de `req/res` façon Express. `scripts/dev.mjs` convertit `node:http` en `Request`/`Response` (Node 24 les fournit en global) et passe l'IP du socket via `x-forwarded-for`.

IP du client : `x-real-ip`, sinon le premier élément de `x-forwarded-for`, sinon `"unknown"`. On ne la stocke **jamais** en clair, seulement `HMAC-SHA256(APP_SECRET, "ip:"+ip+":"+bucket)` dans la table de rate limit.

### Contrôles communs à tout POST, dans cet ordre

1. **Origine** : l'en-tête `Origin` doit avoir le même host que `new URL(request.url).host`. S'il n'y a pas d'`Origin`, `Sec-Fetch-Site` doit valoir `same-origin`. Sinon 403.
2. **Content-Type** : `application/json` (paramètre charset toléré), sinon 415.
3. **Taille** : 2048 octets maximum. Si `content-length` dépasse, 413. On lit ensuite le corps et on revérifie sa taille réelle (413).
4. **Parsing** : le JSON doit être un objet simple, sinon 400.
5. **Liste blanche stricte** : toute clé inconnue donne 400.

Réponses d'erreur : `{"error":"code_court"}`, sans stack trace ni message interne. `Cache-Control: no-store` partout.

### `POST /api/event`

Corps : `{ visitorId, event, lang, utm_source?, utm_medium?, utm_campaign? }`

- `visitorId` : respecte `UUID_V4_RE`.
- `event` : dans `CLIENT_EVENTS`. **`email_soumis` est refusé ici.**
- `lang` : dans `LANGS`.
- UTM optionnels : chaînes passées en minuscules et tronquées à 64 caractères, puis testées avec `UTM_RE`. Si le test échoue, la valeur devient `null` (pas de 400 : les liens UTM sont saisis à la main).
- Si le client envoie un champ `price`, la requête est refusée (400, liste blanche). **Le prix enregistré est toujours `priceFor(config, visitorId, new Date())`, calculé côté serveur.**
- Rate limit : 60 requêtes par minute et par IP (bucket `event`), 429 au-delà.
- `source` = `utm_source` validé, ou `"direct"`.
- Réponse : 204.

### `POST /api/email`

Corps : `{ email, consent, website, visitorId, lang, utm_source?, utm_medium?, utm_campaign? }`

- `website` est le champ piège (honeypot). S'il est non vide : réponse `200 {"ok":true}`, rien n'est écrit.
- `consent` doit valoir **exactement** le booléen `true`, sinon `400 {"error":"consent_required"}`. La chaîne `"true"` est refusée.
- `email` : chaîne passée par `trim` et en minuscules, 254 caractères maximum, testée avec `/^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/`. Sinon `400 {"error":"invalid_email"}`.
- Rate limit : 5 requêtes par tranche de 10 minutes et par IP (bucket `email`).
- Écritures, en une transaction (`db.batch`) :
  - `INSERT INTO emails ... ON CONFLICT(email) DO NOTHING` ;
  - `INSERT INTO events` avec `event='email_soumis'`, sans l'adresse.
  - Un doublon répond pareil qu'un succès (pas d'énumération possible). L'événement n'est inséré qu'une fois par visiteur : si un `email_soumis` existe déjà pour ce `visitor_id`, on ne le réinsère pas. Il n'est inséré que si le visiteur a déjà un `page_vue` (les visiteurs exclus via `?interne=1` ne gonflent pas la conversion). `consent_at` / `created_at` sont arrondis au jour (AAAA-MM-JJ) pour qu'aucune jointure sur l'horodatage ne relie une adresse à un visiteur.
- Réponse : `200 {"ok":true}`.

### Admin

- `POST /api/admin/login {password}`
  - Rate limit : 5 tentatives par tranche de 15 minutes et par IP (bucket `login`).
  - Comparaison en temps constant : `timingSafeEqual` sur `sha256(password)` et `sha256(ADMIN_PASSWORD)`.
  - Si c'est bon : `Set-Cookie: __Host-pu_admin=<expMs>.<hmacBase64url>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`, puis réponse 204. Sinon 401.
- `POST /api/admin/logout` : efface le cookie (`Max-Age=0`), réponse 204.
- `GET /api/admin/stats` : réponse 200, JSON. Requiert un cookie valide et non expiré, comparé en temps constant. Sinon 401. Format :
  ```json
  { "generatedAt": "...", "priceMode": "random", "rows": [
      { "price": 2.5, "source": "instagram_story", "visitors": 0, "clickers": 0, "clickRate": 0,
        "emails": 0, "conversion": 0, "clickRateCI": [lo, hi], "conversionCI": [lo, hi], "questionnaire": 0 } ],
    "byPrice": [ ...même forme, source="*" ], "bySource": [ ...même forme, price=null ], "total": {...} }
  ```
  Les définitions des colonnes :
  - `visitors` : nombre de `visitor_id` distincts ayant un `page_vue` ;
  - `clickers` : `visitor_id` distincts ayant un `clic_precommande` ;
  - `emails` : `visitor_id` distincts ayant un `email_soumis` ;
  - `clickRate` : `clickers / visitors` ;
  - `conversion` : `emails / visitors` ;
  - `*CI` : intervalle de Wilson à 95 %.
- `GET /api/admin/export-events` : CSV `text/csv; charset=utf-8` avec BOM UTF-8 et `Content-Disposition: attachment; filename="events.csv"`. Colonnes : `ts,visitor_id,event,lang,price,price_mode,source,utm_source,utm_medium,utm_campaign`. **Aucun e-mail.**
- `GET /api/admin/export-emails` : CSV `email,lang,consent_at,created_at`.
- **Injection de formules CSV** : toute cellule qui commence par `= + - @ \t \r` est préfixée par `'`. Les guillemets sont échappés selon la RFC 4180.

## Base de données (SQLite / libSQL, requêtes 100 % paramétrées avec `?`)

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, visitor_id TEXT NOT NULL, event TEXT NOT NULL,
  lang TEXT NOT NULL, price_cents INTEGER NOT NULL, price_mode TEXT NOT NULL, source TEXT NOT NULL,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT);
CREATE INDEX IF NOT EXISTS events_visitor ON events(visitor_id, event);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, lang TEXT NOT NULL,
  consent_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start));
```

- **La table `emails` ne contient ni `visitor_id` ni prix.** On peut la vider sans toucher aux statistiques.
- `ts`, `consent_at` et `created_at` sont des dates ISO 8601 UTC.
- `lib/db.js` exporte :
  - `getDb()` : client mémorisé ; le schéma est créé à la première utilisation (promesse unique) ;
  - `setDbForTests(client)` ;
  - `resetDbForTests()`.
- Rate limit : `INSERT ... ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count`. Le nettoyage (`DELETE` des fenêtres de plus d'un jour) tourne au hasard dans environ 1 % des appels.

## `scripts/purge.mjs`

- `emails --yes` : `DELETE FROM emails`.
- `all --yes` : `DROP` des trois tables.
- Sans `--yes`, le script affiche ce qu'il ferait et s'arrête.
- Il charge `.env` avec `process.loadEnvFile` si le fichier existe.

## `scripts/dev.mjs`

- Charge `.env` s'il existe, lance `npm run build` (en important `scripts/build.mjs` ou par `child_process`), puis sert `dist/` sur le port `PORT` ou 3000.
- **Applique les en-têtes de `vercel.json`** (on teste donc la CSP en local) et `cleanUrls` (`/en` → `/en/index.html`, `/privacy` → `/privacy.html`).
- Route `/api/...` vers le module `api/....js`, en appelant son export `GET`/`POST`. Méthode non gérée : 405.
- Protection contre la traversée de chemin : le chemin résolu doit rester dans `dist/`.

## Build (`scripts/build.mjs`) et pages publiques

1. **Validation de la config**, avec arrêt explicite en cas d'erreur :
   - `PRICE_MODE` dans `{random, schedule}` ;
   - `PRICES` non vide, nombres > 0 et < 100 ;
   - calendrier : dates `AAAA-MM-JJ` valides, prix présents dans `PRICES` ;
   - `QUESTIONNAIRE_URL` vide ou en `https://`, ou objet `{ fr, en, it }` de telles URL ;
   - `CONTACT_EMAIL` valide ;
   - `DATA_DELETION_DATE` valide.
2. **Parité des clés** entre `fr.json`, `en.json` et `it.json` (mêmes clés, aucune vide), sinon erreur.
3. **Pages générées**, une par langue :
   - FR : `/`, `/privacy`, `/legal` → `dist/index.html`, `dist/privacy.html`, `dist/legal.html` ;
   - EN : `/en`, `/en/privacy`, `/en/legal` → `dist/en/index.html`, `dist/en/privacy.html`, `dist/en/legal.html` ;
   - IT : même chose sous `/it`.
   - Les URL publiques (canonical, hreflang, `og:url`, liens) n'ont **pas de « / » final** (`vercel.json` : `trailingSlash: false`, sinon redirection 308). Le lien « FR » de l'accueil pointe vers `/?lang=fr`.
   - Chaque page porte `<html lang>`, `<link rel=alternate hreflang>`, et des balises Open Graph et Twitter (titre, description, image en URL absolue `SITE_URL/og.png` 1200×630, `og:locale` fr_FR / en_GB / it_IT (en.json est en anglais britannique, dates formatées en `en-GB`), `og:url`).
   - Le texte est échappé en HTML. Les placeholders de locale (`{brand}`, `{contactEmail}`, `{deletionDate}` formatée dans la langue, `{publisher}`) sont remplacés au build.
4. **Config publique pour le navigateur** : `dist/assets/site-config.js` est un module ES qui exporte **uniquement** `PRICE_MODE`, `PRICES`, `PRICE_SCHEDULE`, `CURRENCY`, `QUESTIONNAIRE_URL`, `BRAND_NAME`. Aucun script inline.
5. **Bundle JS** : esbuild, bundle + minify, ESM ; Three.js est chargé en `import()` dynamique (code-splitting). Les polices `@fontsource` sont copiées dans `dist/assets/fonts/`.
6. **Images** :
   - `public/product.png` est utilisé s'il existe, sinon une image de remplacement neutre (SVG générée dans `src/site/`) ;
   - `og.png` : copie de `public/og.png` s'il existe, sinon un PNG 1200×630 neutre généré en Node pur (`zlib`), sans dépendance.
7. **Contraintes CSP** (`script-src 'self'; style-src 'self'`) : **aucun `<script>` inline, aucun attribut `style="..."`, aucun `onclick=`, aucune ressource externe** (polices, CDN, analytics…). Modifier `element.style` en JS est autorisé.
8. Le tableau de bord est copié de `src/admin/` vers `dist/admin/` (`index.html` y est servi à l'URL `/admin`).
9. `dist/robots.txt` interdit `/admin` et `/api`.

### Comportement du navigateur (`src/site/js`)

- **Opt-out** : `?interne=1` (équipe) ou le bouton « Ne plus être mesuré » de la page Confidentialité (visiteurs) met `optout` à `"1"` ; `?interne=0` ou « Réactiver la mesure » le supprime. Si `optout` vaut `"1"`, aucun événement n'est envoyé.
- **Identifiant visiteur** : `crypto.randomUUID()` dans `localStorage[LS.visitor]` sous la forme `{id, created}`, renouvelé au-delà de `VISITOR_TTL_MS`. Si `localStorage` est indisponible, on utilise un identifiant en mémoire pour la page.
- **UTM** : premier contact. On les lit dans l'URL à la première visite et on les stocke. Plus tard, une visite arrivant avec de nouveaux UTM ne les écrase pas.
- **Langue** : sur `/` (FR) seulement. S'il n'y a pas de `LS.lang` et que `navigator.languages` préfère `en` ou `it` avant `fr`, on fait `location.replace('/en' + location.search)` (ou `/it`). Pas de redirection si l'URL contient `?lang=fr` (choix du FR même quand `localStorage` est indisponible).
  - Le sélecteur de langue est fait de liens qui conservent `location.search` et enregistrent `LS.lang` au clic.
  - Repli sur FR.
- **Prix** : `priceFor(config, visitorId)`, puis `Intl.NumberFormat(lang, {style:'currency', currency})`.
- **Envoi des événements** : `fetch('/api/event', {method:'POST', keepalive:true, headers:{'Content-Type':'application/json'}, body})`. **Pas de `sendBeacon`.** Les erreurs sont ignorées en silence.
- `page_vue` est envoyé au chargement.
- **Clic sur « Précommander »** (tous les boutons) :
  1. envoi de `clic_precommande` ;
  2. ouverture d'un `<dialog>` avec le message honnête : produit en développement, pas encore en vente ;
  3. formulaire e-mail facultatif. La case de consentement est **non cochée** et `required`, avec le texte et la date de suppression. Le formulaire contient aussi le champ piège `website`, caché hors écran, avec `tabindex=-1`, `autocomplete=off` et `aria-hidden`.
  4. Le bouton « Non merci » ferme simplement le dialogue.
- **Envoi du formulaire** : `POST /api/email` avec les UTM. En cas de succès, l'écran de remerciement s'affiche, avec le lien vers le questionnaire (`target=_blank rel="noopener noreferrer"`) **seulement si** `QUESTIONNAIRE_URL` est non vide pour la langue de la page. Le lien est construit par `src/shared/questionnaire.js` : champs cachés `p` (prix au format de la langue), `arm` (centimes), `lang`, `src` (`site_` + utm_source ou `site_direct`), sans identifiant visiteur. Le clic sur ce lien envoie `clic_questionnaire`. En cas d'erreur, un message localisé s'affiche.
- **Bannière d'information** : courte, en bas de page, avec un lien vers Confidentialité et un bouton « OK » qui enregistre `LS.banner`. C'est une information, pas un mur de consentement : la mesure est pseudonyme (identifiant aléatoire, sans nom ni e-mail) et ne pose aucun cookie.

## Règles de contenu (obligatoires, dans les trois langues)

- **Interdit** : rupture de stock, compte à rebours, rareté, « plus que X », faux avis ou témoignages, faux partenaires ou experts, fausses statistiques, logos de médias, collecte de carte bancaire ou d'adresse, case pré-cochée.
- **Allégations santé** (règlement UE 1924/2006 et règlement 432/2012) : la **seule** allégation autorisée pour la créatine est que la créatine augmente la performance physique lors d'exercices brefs, intenses et répétés, l'effet bénéfique étant obtenu avec une consommation journalière de 3 g. On n'emploie aucune autre allégation : ni « prise de muscle », ni « récupération », ni « énergie », ni « cerveau », ni « guérit ». « Monohydrate de créatine », « 3 à 5 g », « stockée au sec dans le bouchon » et « dose prête » sont des faits produit, donc acceptables.
- Pour expliquer pourquoi la poudre est séparée de la boisson, on peut dire « la créatine est plus stable sous forme sèche », formulé prudemment.
- Le pied de page mentionne « Projet étudiant ESCP Business School » et renvoie vers Confidentialité et Mentions légales.
- **Mentions légales** :
  - éditeur : `PUBLISHER`, avec le contact `CONTACT_EMAIL` ;
  - hébergeur : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis ;
  - base de données : Turso (ChiselStrike Inc.), avec une instance en région UE ;
  - mention qu'il s'agit d'un test de concept : aucun produit n'est vendu.
- **Confidentialité** :
  - responsables de traitement : `PUBLISHER`, avec le contact ;
  - finalités : mesure d'audience pseudonyme du test de prix (identifiant aléatoire, sans nom ni e-mail), et contact au lancement si consentement ;
  - données collectées : identifiant aléatoire stocké dans le navigateur (`localStorage`), événements, langue, prix affiché, source UTM ; e-mail seulement avec consentement ; IP seulement sous forme hachée et temporaire pour l'anti-spam ;
  - ce qui n'est pas collecté : pas de cookies de mesure, pas de Google Analytics, pas de publicité, pas de revente ;
  - bases légales : intérêt légitime (mesure pseudonyme, avec droit d'opposition), consentement (e-mail) ;
  - conservation : suppression au plus tard le `{deletionDate}` ;
  - destinataires : l'équipe projet ; sous-traitants : Vercel (hébergement, transferts encadrés par le Data Privacy Framework UE-États-Unis), Turso (base en UE) ;
  - données : préciser la durée de vie de l'identifiant (13 mois maximum) et que la source de la première visite est gardée dans le navigateur ;
  - droits : accès, rectification, effacement, limitation du traitement, portabilité de l'e-mail, opposition, retrait du consentement, en écrivant à l'e-mail de contact ; droit de réclamation auprès de la CNIL (cnil.fr) ou, en EN/IT, de l'autorité du pays du visiteur (Italie : Garante per la protezione dei dati personali) ;
  - comment ne plus être mesuré : boutons « Ne plus être mesuré » / « Réactiver la mesure » sur la page Confidentialité (ils écrivent / suppriment `LS.optout`, comme `?interne=1` / `?interne=0`). Effacer les données du site annule ce choix.
