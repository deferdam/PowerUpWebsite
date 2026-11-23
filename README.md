# FRUCDOZ — test d'intention d'achat (projet étudiant ESCP)

Ce site est un **« fake door test »** (test de la fausse porte). Il présente une boisson prête à boire dont le bouchon contient 3 à 5 g de créatine monohydrate stockée au sec : on appuie sur le bouchon, la poudre tombe, on secoue, on boit. Il mesure **combien de visiteurs cliquent sur « Précommander » selon le prix affiché** (2,50 €, 3,50 € ou 4,50 €) et selon la source du visiteur (Instagram, affiche en salle, LinkedIn…).

**Rien n'est vendu ni encaissé.** Au clic, le visiteur lit tout de suite que le produit est en développement et pas encore en vente. Il peut laisser son e-mail s'il le souhaite (case de consentement non cochée), puis répondre à un questionnaire.

- Site public en trois langues : FR (par défaut), EN, IT. Pages `/`, `/privacy`, `/legal`, et la même chose sous `/en` et `/it`.
- Tableau de bord protégé par mot de passe : `/admin`.
- Contrat technique détaillé : [`docs/SPEC.md`](docs/SPEC.md). Cahier des charges de l'équipe : [`docs/CAHIER_DES_CHARGES.md`](docs/CAHIER_DES_CHARGES.md).

> **NOTE IMPORTANTE — traductions** : les textes anglais et italiens (`locales/en.json`, `locales/it.json`) **doivent être relus par un locuteur natif** avant la mise en ligne. Voir la [section 5](#5-traductions).

## Sommaire

1. [Principes d'honnêteté](#1-principes-dhonnêteté)
2. [Choix techniques et pourquoi](#2-choix-techniques-et-pourquoi)
3. [Installation locale](#3-installation-locale)
4. [Déploiement gratuit (Vercel + Turso)](#4-déploiement-gratuit-vercel--turso)
5. [Traductions](#5-traductions)
6. [Modifier les prix, le mode, le calendrier, la marque…](#6-modifier-les-prix-le-mode-le-calendrier-la-marque)
7. [Image du produit](#7-image-du-produit)
8. [Liens UTM (Instagram, salles, LinkedIn)](#8-liens-utm-instagram-salles-linkedin)
9. [Lire le tableau de bord](#9-lire-le-tableau-de-bord)
10. [Suppression des données en fin de projet](#10-suppression-des-données-en-fin-de-projet)
11. [Sécurité : les règles qui ne changent jamais](#11-sécurité--les-règles-qui-ne-changent-jamais)
12. [Tests automatisés](#12-tests-automatisés)
13. [Structure du projet](#13-structure-du-projet)

---

## 1. Principes d'honnêteté

Un fake door test n'est acceptable que s'il ne trompe personne. Le site respecte donc ces règles, dans les trois langues :

- **Aucun paiement, aucune carte bancaire, aucune adresse postale.** Le bouton « Précommander » ouvre un message clair : produit en développement, pas encore en vente.
- **Aucun dark pattern** : pas de fausse rupture de stock, pas de compte à rebours, pas de « plus que 3 en stock », pas de faux avis, faux experts, faux partenaires, logos de médias ou fausses statistiques. Un test automatique cherche ces mots dans les textes.
- **E-mail facultatif**, avec une case de consentement **non cochée** qui indique la date de suppression des données.
- **Une seule allégation santé** (règlements UE 1924/2006 et 432/2012) : la créatine augmente la performance physique lors d'exercices brefs, intenses et répétés (effet obtenu avec 3 g par jour). Rien sur la « prise de muscle », la « récupération », l'« énergie », etc.
- **Mesure d'audience minimale et transparente** : identifiant aléatoire dans le navigateur (pas de nom, pas d'e-mail, pas d'empreinte), **aucun cookie de mesure, pas de Google Analytics, pas de publicité**. Une bannière d'information renvoie vers la page Confidentialité, où chacun peut désactiver la mesure.
- **Les e-mails sont stockés à part** des statistiques (deux tables, sans lien entre elles) et tout est supprimé au plus tard à la date `DATA_DELETION_DATE`.

## 2. Choix techniques et pourquoi

| Besoin | Choix | Pourquoi |
| --- | --- | --- |
| Hébergement du site et des fonctions serveur | **Vercel** (offre gratuite « Hobby ») | Déploiement automatique à chaque `git push`, HTTPS inclus, région Paris (`cdg1`) pour les fonctions. L'offre Hobby est réservée à un usage non commercial : c'est le cas ici (projet étudiant, rien n'est vendu). |
| Base de données | **Turso** (SQLite hébergé, offre gratuite) | S'installe en deux clics depuis Vercel, injecte ses variables d'environnement toute seule, région UE possible, SQL classique (requêtes simples à lire). En local, le même code écrit dans un simple fichier `local.db`. |
| Mesure d'audience | **Faite maison** (table `events`) | Pas de cookies donc pas de mur de consentement, pas de Google Analytics (transferts de données vers Google, critiqué par la CNIL), et on mesure exactement ce dont on a besoin : le prix vu par chaque visiteur. |
| Animations 3D | **Three.js**, chargé à la demande | La page reste légère sur mobile ; sans 3D (vieux téléphone, « réduire les animations »), le site marche quand même. |

Alternatives écartées, en bref :

- **Plausible** : excellent pour la vie privée, mais payant (pas d'offre gratuite durable), et il ne sait pas relier un clic au prix affiché à ce visiteur précis.
- **Firebase** (Google) : données traitées par Google, règles de sécurité à écrire côté navigateur (faciles à mal configurer), SDK lourd à charger.
- **Supabase** : l'offre gratuite met le projet en pause après une semaine sans activité (gênant pendant un test de plusieurs semaines), et la clé publique dans le navigateur impose de bien maîtriser les règles RLS.

## 3. Installation locale

Prérequis : **Node.js 20 ou plus récent** (24 conseillé). Vérifier avec `node -v`.

```bash
npm install
cp .env.example .env
```

Ouvrir `.env` et remplir :

- `ADMIN_PASSWORD` : un mot de passe d'au moins 12 caractères (sinon `/admin` reste fermé) ;
- `APP_SECRET` : un secret aléatoire d'au moins 32 caractères. Pour le générer :

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- laisser `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` **vides** en local : les données vont alors dans le fichier `local.db` (ignoré par git). Ne jamais y mettre les identifiants de production, sinon vos essais locaux écrivent dans la vraie base.

Puis :

```bash
npm run dev
```

- Site : <http://localhost:3000> (et <http://localhost:3000/en>, <http://localhost:3000/it>).
- Tableau de bord : <http://localhost:3000/admin> (utiliser Chrome ou Firefox en local : le cookie de connexion est marqué `Secure`, ces navigateurs l'acceptent sur `localhost`).
- Autre port : `PORT=3001 npm run dev`.

Autres commandes :

```bash
npm test          # lance tous les tests automatisés (environ 2 secondes)
npm run build     # génère seulement le dossier dist/
```

Le serveur local applique les mêmes en-têtes de sécurité que Vercel (dont la CSP) : si quelque chose est bloqué en local, il le sera aussi en ligne.

## 4. Déploiement gratuit (Vercel + Turso)

Le projet Vercel est déjà importé depuis le dépôt GitHub `deferdam/PowerUpWebsite`. Chaque `git push` sur la branche principale redéploie le site. Les réglages de build sont lus dans `vercel.json` (commande `npm run build`, dossier `dist`, région Paris).

### 4.1 Ajouter la base Turso

1. Sur [vercel.com](https://vercel.com), ouvrir le projet, onglet **Storage** (ou **Marketplace**), choisir **Turso**, puis créer une base gratuite.
2. **Choisir une région de l'Union européenne** (par exemple Francfort, Paris ou Irlande, selon ce qui est proposé). C'est obligatoire : la page Confidentialité affirme que la base est dans l'UE.
3. Relier la base au projet pour les environnements **Production** et **Preview**. L'intégration ajoute toute seule `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN`.

Les tables sont créées automatiquement à la première requête : rien à faire à la main.

### 4.2 Ajouter les secrets

Dans le projet Vercel : **Settings > Environment Variables**, ajouter pour **Production** et **Preview** :

| Variable | Valeur |
| --- | --- |
| `ADMIN_PASSWORD` | mot de passe de `/admin`, 12 caractères minimum (différent de celui utilisé en local) |
| `APP_SECRET` | nouveau secret de 32 caractères minimum (commande de la section 3) |

Facultatif : `SITE_URL` si vous utilisez un nom de domaine personnalisé (ex. `https://frucdoz.fr`, sans « / » final). Sinon, l'URL `*.vercel.app` est détectée automatiquement pour les balises Open Graph.

### 4.3 Redéployer et vérifier

1. **Deployments >** dernier déploiement **> Redeploy** (les variables ne sont prises en compte qu'au déploiement suivant).
2. Ouvrir `https://<ton-projet>.vercel.app` puis `https://<ton-projet>.vercel.app/admin` et se connecter.
3. Vérifier les en-têtes de sécurité :

   ```bash
   curl -sI https://<ton-projet>.vercel.app/ | grep -iE "content-security-policy|strict-transport-security|x-content-type-options"
   ```

   Les trois lignes doivent apparaître (ou tester l'URL sur <https://securityheaders.com>).
4. Ouvrir une fois le site avec `?interne=1` sur vos propres appareils (voir section 8) pour ne pas vous compter.

Si `/admin` affiche « Tableau de bord désactivé » : `ADMIN_PASSWORD` ou `APP_SECRET` manque ou est trop court, ou le site n'a pas été redéployé.

### 4.4 Changer l'adresse du site (ex. `frucdoz.vercel.app`)

Aujourd'hui, le site est en ligne sur `https://upkap.vercel.app` (ancien nom de la marque).

1. Vercel, ouvrir le projet, puis **Settings > Domains > Add Domain**.
2. Taper `frucdoz.vercel.app` et valider. Si l'adresse est déjà prise par quelqu'un d'autre, essayer `frucdoz-test.vercel.app` ou `drink-frucdoz.vercel.app`.
3. Sur la ligne `upkap.vercel.app` : **Edit**, puis **Redirect to** `frucdoz.vercel.app` (308). Les anciens liens continuent de marcher.
4. **Deployments > Redeploy**. Les balises Open Graph prennent alors automatiquement la nouvelle adresse : Vercel choisit le domaine de production le plus court.
5. Facultatif : **Settings > General > Project Name**, renommer le projet en `frucdoz`. Cela change seulement le nom dans le tableau de bord Vercel, pas l'adresse (c'est l'étape 2 qui la change).

Pour changer le **nom de la marque** affiché sur le site, il suffit de modifier `BRAND_NAME` dans `site.config.js` (section 6), puis de faire un commit et un push.

### 4.5 Dépannage

| Symptôme | Cause | Solution |
| --- | --- | --- |
| `/admin` affiche « admin désactivé » / `/api/admin/stats` renvoie `503 admin_disabled` | `ADMIN_PASSWORD` (12 caractères min.) ou `APP_SECRET` (32 min.) manquant | Section 4.2, puis Redeploy |
| `/api/event` ou `/api/email` renvoie `500 internal_error` | Pas de base Turso : sur Vercel, le fichier local n'est pas accessible en écriture | Section 4.1, puis Redeploy |
| Les variables sont ajoutées mais rien ne change | Pas de redéploiement, ou variables seulement en « Development » | Cocher Production + Preview, puis Redeploy |
| Le site affiche toujours l'ancien texte | Le cache du navigateur ou d'Instagram | Recharger ; pour l'aperçu Instagram/Facebook : https://developers.facebook.com/tools/debug/ |

## 5. Traductions

<!-- NOTE : les traductions EN et IT doivent être relues par un locuteur natif avant la mise en ligne. -->

> **NOTE** : les traductions **anglaise et italienne doivent être relues par un locuteur natif** avant la mise en ligne (et après chaque modification importante). Elles ont été écrites avec soin mais pas validées par un natif.

- Tous les textes du site public sont dans `locales/fr.json`, `locales/en.json` et `locales/it.json`.
- Les trois fichiers doivent avoir **exactement les mêmes clés**, et aucun texte vide : sinon le build s'arrête avec un message clair.
- Les marqueurs `{brand}`, `{contactEmail}`, `{deletionDate}` et `{publisher}` sont remplacés automatiquement au build (la date est écrite dans le format de chaque langue). Ne pas les traduire.
- L'anglais est en anglais britannique (dates au format `en-GB`).
- En modifiant un texte, respecter les règles de la section 1 (aucune fausse rareté, une seule allégation santé). Les textes du tableau de bord `/admin` sont en français uniquement (`src/admin/`).

## 6. Modifier les prix, le mode, le calendrier, la marque…

Tout se règle dans **un seul fichier : `site.config.js`**. Ensuite : `git commit` puis `git push`, Vercel redéploie tout seul. Le build vérifie la configuration et s'arrête avec un message clair en cas d'erreur (le site en ligne reste alors sur la version précédente).

| Réglage | Exemple | Rôle |
| --- | --- | --- |
| `BRAND_NAME` | `'FRUCDOZ'` | Nom de la marque partout sur le site. Vérifier sa disponibilité (INPI / EUIPO) avant tout lancement réel. |
| `PRICES` | `[2.5, 3.5, 4.5]` | Prix testés en euros par bouteille (nombres entre 0 et 100). |
| `PRICE_MODE` | `'random'` | `'random'` : chaque visiteur reçoit au hasard un des prix, toujours le même pour lui. `'schedule'` : le prix dépend de la date (heure de Paris), selon `PRICE_SCHEDULE`. |
| `PRICE_SCHEDULE` | `{ from: '2026-11-16', price: 2.5 }` | Utilisé seulement en mode `'schedule'`. À partir de chaque date (incluse), ce prix s'applique. Chaque prix doit figurer dans `PRICES`. |
| `QUESTIONNAIRE_URL` | `{ fr: 'https://tally.so/r/…', en: …, it: … }` | Questionnaire de l'écran de remerciement, une URL par langue (ou une seule URL pour toutes). Doit commencer par `https://`. Vide (`''`) = lien masqué. Le site ajoute au lien les champs cachés Tally `p` (prix vu, « 3,50 »), `arm` (prix en centimes), `lang` et `src` (`site_` + source UTM) : la question sur le prix affiche donc le même prix que le site. Aucun identifiant visiteur n'est transmis. |
| `CONTACT_EMAIL` | `'prenom.nom@...'` | Contact affiché sur les pages Confidentialité et Mentions légales. |
| `PUBLISHER` | `'Prénom NOM, Prénom NOM — étudiants ESCP…'` | **Obligatoire avant la mise en ligne** : noms des membres de l'équipe (éditeur du site et responsables de traitement). |
| `DATA_DELETION_DATE` | `'2027-06-30'` | Date limite de suppression de toutes les données, affichée sur le site et dans la case de consentement. |

Conseil : ne changez pas `PRICES` ni `PRICE_MODE` **pendant** le test. Sinon, un même visiteur peut voir un autre prix, et les résultats avant / après ne sont plus comparables. Si vous devez le faire, notez la date et exportez les données avant.

## 7. Image du produit

- Déposer le visuel du produit dans **`public/product.png`** (fond transparent conseillé, environ 1000 px de haut). Il remplace automatiquement l'image neutre de remplacement.
- Facultatif : déposer **`public/og.png`** en **1200 × 630 px**. C'est l'image affichée quand le lien est partagé (Instagram, WhatsApp, LinkedIn…). Sans ce fichier, une image neutre est générée.
- Puis commit + push. Sans `product.png`, le site garde le visuel de remplacement neutre.

## 8. Liens UTM (Instagram, salles, LinkedIn)

Un lien UTM est un lien normal auquel on ajoute des étiquettes qui disent **d'où vient le visiteur**. Le tableau de bord sépare ainsi les résultats par source : on peut comparer, par exemple, les visiteurs venus d'une story Instagram et ceux qui ont scanné une affiche en salle.

```
https://<ton-projet>.vercel.app/?utm_source=SOURCE&utm_medium=MOYEN&utm_campaign=CAMPAGNE
```

- `utm_source` : **où** le lien a été posté (c'est la colonne « source » du tableau de bord) ;
- `utm_medium` : **le type** de canal (`social`, `affiche`…) ;
- `utm_campaign` : **le nom** de l'opération, le même pour tout le test, par exemple `lancement_test`.

Règles : minuscules, chiffres, `_`, `.` ou `-` uniquement, 64 caractères maximum, **pas d'espace ni d'accent**. Une valeur invalide est ignorée (la visite compte alors comme `direct`).

| Où le lien est publié | `utm_source` | `utm_medium` | Lien complet |
| --- | --- | --- | --- |
| Story Instagram | `instagram_story` | `social` | `https://<ton-projet>.vercel.app/?utm_source=instagram_story&utm_medium=social&utm_campaign=lancement_test` |
| Bio Instagram | `instagram_bio` | `social` | `https://<ton-projet>.vercel.app/?utm_source=instagram_bio&utm_medium=social&utm_campaign=lancement_test` |
| Affiche + QR code dans une salle (une source **par salle**) | `salle_basicfit_paris11` | `affiche` | `https://<ton-projet>.vercel.app/?utm_source=salle_basicfit_paris11&utm_medium=affiche&utm_campaign=lancement_test` |
| Une autre salle | `salle_onair_lyon3` | `affiche` | `https://<ton-projet>.vercel.app/?utm_source=salle_onair_lyon3&utm_medium=affiche&utm_campaign=lancement_test` |
| Post LinkedIn | `linkedin` | `social` | `https://<ton-projet>.vercel.app/?utm_source=linkedin&utm_medium=social&utm_campaign=lancement_test` |

- **QR code des affiches** : générer le QR code à partir du lien complet de la salle (n'importe quel générateur de QR code gratuit et sans redirection, ou l'outil intégré du navigateur Chrome / Edge : « Partager > Créer un code QR »). Scanner le QR code pour vérifier avant d'imprimer.
- **Version anglaise ou italienne** : remplacer `/?` par `/en?` ou `/it?`, par exemple `https://<ton-projet>.vercel.app/en?utm_source=linkedin&utm_medium=social&utm_campaign=lancement_test`. Sans cela, la langue est choisie d'après le navigateur du visiteur.
- La source retenue est celle de la **première** visite (elle n'est pas écrasée ensuite). Sans UTM, la source vaut `direct`.

**Ne pas compter l'équipe** : chaque membre ouvre une fois `https://<ton-projet>.vercel.app/?interne=1` **sur chacun de ses téléphones et ordinateurs** (et dans chaque navigateur). Plus aucun événement n'est envoyé depuis ce navigateur. `?interne=0` réactive la mesure. Attention : la navigation privée ou l'effacement des données du site annule ce réglage. Les visiteurs ont le même choix grâce au bouton « Ne plus être mesuré » de la page Confidentialité.

## 9. Lire le tableau de bord

`https://<ton-projet>.vercel.app/admin` affiche trois tableaux : **par prix**, **par source**, et **par prix et par source**. Deux exports CSV sont disponibles : les événements (sans aucun e-mail) et, séparément, les e-mails.

### Définitions

| Colonne | Définition |
| --- | --- |
| Visiteurs | nombre de visiteurs uniques (identifiants aléatoires distincts) ayant vu la page |
| Clics | visiteurs uniques ayant cliqué au moins une fois sur « Précommander » |
| Taux de clic | clics ÷ visiteurs : **l'indicateur principal d'intention d'achat** |
| E-mails | visiteurs uniques ayant laissé leur e-mail (avec consentement) |
| Conversion | e-mails ÷ visiteurs : une intention plus forte que le simple clic |
| Questionnaire | visiteurs ayant cliqué sur le lien du questionnaire |
| IC 95 % | intervalle de confiance à 95 % (méthode de Wilson) |

Un « visiteur » est un navigateur, pas une personne : la même personne sur son téléphone et son ordinateur compte deux fois.

### L'intervalle de confiance

Avec peu de visiteurs, le hasard pèse lourd. Si 3 visiteurs sur 20 cliquent, le taux observé est 15 %, mais le « vrai » taux se situe plausiblement **entre 5 % et 36 %** : c'est ce que dit l'intervalle de confiance. Plus il y a de visiteurs, plus l'intervalle est étroit.

**Règle de lecture** : si les intervalles de deux prix se chevauchent largement, **on ne peut pas conclure** que l'un fait mieux que l'autre. La différence observée peut venir du hasard.

### Combien de visiteurs faut-il ? (ordres de grandeur)

| Visiteurs par prix | Précision du taux de clic (si le taux est autour de 10 %) |
| --- | --- |
| 30 | environ ± 11 points : on ne peut rien conclure |
| 100 | environ ± 6 points : tendance seulement |
| 400 | environ ± 3 points : utilisable |
| 1 000 | environ ± 2 points : solide |

- Pour distinguer un prix qui fait **5 %** de clics d'un prix qui fait **10 %**, il faut environ **400 à 450 visiteurs par prix** (soit environ 1 300 visiteurs pour 3 prix).
- Pour distinguer **10 %** de **15 %**, il faut environ **700 visiteurs par prix**.
- Avec moins de **100 visiteurs par prix**, ne présentez les chiffres que comme une tendance, jamais comme une preuve.
- Évitez de regarder les résultats tous les jours pour arrêter le test dès qu'un prix « gagne » : fixez à l'avance une date de fin ou un nombre de visiteurs.
- Les chiffres par prix **et** par source découpent les données en petits groupes : ils servent à repérer un problème (une source qui n'amène personne), rarement à conclure.

## 10. Suppression des données en fin de projet

Toutes les données doivent être supprimées **au plus tard à la date `DATA_DELETION_DATE`** (affichée sur le site). Ces suppressions sont **irréversibles** : exporter d'abord les CSV utiles depuis `/admin` (et ne garder que des résultats agrégés, sans e-mail, dans vos livrables).

### Option A : avec les scripts du projet

Les scripts lisent le fichier `.env`. Pour viser la base de production, récupérer ses identifiants avec la CLI Vercel :

```bash
npx vercel link                                          # relie le dossier au projet Vercel (une fois)
npx vercel env pull .env --environment=production        # écrit les variables de production dans .env
```

Si `TURSO_DATABASE_URL` ou `TURSO_AUTH_TOKEN` arrive vide (variables marquées « sensibles »), les copier depuis le tableau de bord Turso (page de la base, bouton de connexion / création de jeton) dans `.env`.

Puis :

```bash
npm run purge:emails              # affiche ce qui serait supprimé, sans rien supprimer
npm run purge:emails -- --yes     # vide la table des e-mails (les statistiques restent)
npm run purge:all -- --yes        # supprime toutes les tables : événements, e-mails, rate limit
```

Le script affiche la base visée (`Base : libsql://…`) : vérifier que c'est bien la production. **Ensuite, supprimer le fichier `.env`** (ou le remettre comme en section 3), pour ne pas écrire par erreur dans la vraie base depuis votre ordinateur.

### Option B : depuis les tableaux de bord

1. Supprimer la base dans le tableau de bord **Turso** (ou dans Vercel > Storage > la base > Settings > Delete).
2. Supprimer le projet **Vercel** : Settings > General > Delete Project (le site disparaît et ses journaux avec).

En fin de projet, faire les deux : purger / supprimer la base, **puis** supprimer le projet Vercel.

### Répondre à une demande d'un visiteur (accès, effacement, retrait du consentement)

Répondre dans un délai d'**un mois** maximum, depuis l'adresse `CONTACT_EMAIL`.

1. Vérifier si l'adresse est présente : export des e-mails dans `/admin`.
2. La supprimer dans la console SQL de la base, dans le tableau de bord Turso. Modèle de requête (remplacer l'adresse par celle de la demande, en minuscules) :

   ```sql
   DELETE FROM emails WHERE email = 'adresse.du.visiteur@exemple.com';
   ```

3. Confirmer au visiteur que c'est fait.

Les statistiques (table `events`) ne contiennent ni nom ni e-mail : elles ne sont liées à personne de façon directe.

## 11. Sécurité : les règles qui ne changent jamais

- **Aucun secret dans le dépôt** (il est public) : mots de passe et clés uniquement dans les variables d'environnement Vercel ou dans `.env` (ignoré par git).
- **Le serveur recalcule toujours le prix** vu par le visiteur (`src/shared/pricing.js`). Un prix envoyé par le navigateur est refusé.
- **L'événement `email_soumis` ne peut être écrit que par le serveur**, jamais envoyé directement par le navigateur.
- **Tout POST est vérifié** dans cet ordre : origine du site (sinon 403), `Content-Type: application/json` (415), taille maximale 2 Ko (413), JSON valide (400), liste blanche stricte des champs (400).
- **Consentement** : il doit valoir exactement `true` (une case non cochée ou la chaîne `"true"` sont refusées).
- **Limites de requêtes par IP** : 60 événements par minute, 5 e-mails par 10 minutes, 5 tentatives de connexion admin par 15 minutes. Les IP ne sont **jamais stockées en clair** (seulement une empreinte HMAC temporaire). Un champ piège invisible bloque les robots.
- **Requêtes SQL 100 % paramétrées** (aucune concaténation de texte dans le SQL).
- **E-mails séparés des statistiques** : la table `emails` ne contient ni identifiant visiteur ni prix.
- **Admin** : mot de passe comparé en temps constant ; cookie `__Host-` signé, `HttpOnly`, `Secure`, `SameSite=Strict`, valable 8 heures. Sans `ADMIN_PASSWORD` (12 caractères min.) ou `APP_SECRET` (32 caractères min.), l'admin reste fermé.
- **Exports CSV** protégés contre l'injection de formules Excel (`=`, `+`, `-`, `@`…).
- **En-têtes de sécurité** sur toutes les pages (`vercel.json`) : CSP stricte (aucun script inline, aucune ressource externe : polices et Three.js sont servis par le site), HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. `/api` et `/admin` ne sont jamais mis en cache ni indexés.

## 12. Tests automatisés

```bash
npm test
```

Les tests utilisent une base en mémoire : ils ne touchent ni `local.db` ni la production. Ils vérifient notamment :

- **Prix** : attribution aléatoire stable (un visiteur garde toujours le même prix), répartition équilibrée (30 000 visiteurs simulés), mode calendrier (changement à minuit heure de Paris, hiver comme été), cohérence de `site.config.js`.
- **Événements** : enregistrement de tous les champs, prix recalculé par le serveur, source `direct` sans UTM, UTM invalides ignorés, refus de `email_soumis` et des champs inconnus, contrôles d'origine / Content-Type / taille / JSON, limite de 60 requêtes par minute.
- **E-mails** : consentement obligatoire (absent, `false` ou `"true"` refusés), e-mails invalides refusés, champ piège, doublons sans fuite d'information, table `emails` sans identifiant visiteur ni prix, limite de 5 envois.
- **Admin** : accès refusé sans cookie ou avec un cookie falsifié ou expiré, mauvais mot de passe et blocage après 5 essais, admin fermé sans mot de passe ou sans secret, chiffres exacts des statistiques, intervalle de Wilson, exports CSV (aucun e-mail dans l'export des événements, neutralisation des formules).
- **Serveur local et en-têtes** : CSP / HSTS / nosniff sur toutes les pages, pas de cache sur `/api` et `/admin`, protection contre la traversée de dossiers et le « DNS rebinding ».
- **Site généré** : les 9 pages existent, langue / hreflang / Open Graph corrects, aucun script inline ni `style=""`, case de consentement non cochée, textes exigés par le cahier des charges, aucun mot de dark pattern dans aucune langue, mêmes clés dans les trois traductions, validation de la configuration, JS principal léger avec Three.js séparé.

## 13. Structure du projet

```
site.config.js        LE fichier de réglages (marque, prix, mode, calendrier, questionnaire, contact, date de suppression)
locales/              textes du site : fr.json, en.json, it.json
public/               fichiers copiés tels quels : product.png (à ajouter), og.png (facultatif), favicon.svg, robots.txt
src/site/             site public : gabarits HTML, CSS, JavaScript, scène 3D (Three.js)
src/admin/            tableau de bord /admin (HTML, CSS, JS)
src/shared/           code commun navigateur + serveur : calcul du prix, constantes
api/                  fonctions serveur Vercel : /api/event, /api/email, /api/admin/*
lib/                  code serveur : base de données, validation, limites de requêtes, authentification, CSV, statistiques
scripts/build.mjs     génère le site dans dist/ (et vérifie la configuration et les traductions)
scripts/dev.mjs       serveur local (npm run dev)
scripts/purge.mjs     suppression des données (npm run purge:emails / purge:all)
tests/                tests automatisés (npm test)
docs/                 spécification technique (SPEC.md) et cahier des charges
vercel.json           réglages Vercel : build, région, en-têtes de sécurité
.env.example          modèle des variables d'environnement (à copier en .env, jamais commité)
dist/                 site généré (ignoré par git)
```
