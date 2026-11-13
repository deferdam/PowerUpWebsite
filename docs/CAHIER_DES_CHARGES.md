# Cahier des charges (fourni par l'équipe)

Le site sert à tester l'intention d'achat (« fake door test ») dans le cadre d'un projet étudiant de l'ESCP (Option Entrepreneuriat). Le produit n'existe pas encore. Le site mesure l'intention d'achat sans jamais vendre, encaisser ni tromper le visiteur.

Décisions prises après le cahier des charges :
- le test de prix se fait en **mode aléatoire** par défaut ;
- la base de données est **Turso** (intégration Vercel Marketplace) ;
- le contact est **damien.defer@proton.me** ;
- la date de suppression par défaut est le **30/06/2027** ;
- l'URL du questionnaire sera fournie plus tard ;
- le design s'inspire de deux références Awwwards, sans les copier : « Solara Halo S1 » (rotation 3D du produit à la souris) et « David Protein » (pédagogie par l'interaction), le tout dans un univers protéine / créatine / salle de sport.

## Contexte produit
- **Produit** : une boisson prête à boire avec une dose de créatine (3 à 5 g) stockée au sec dans le bouchon. On appuie sur le bouchon, la poudre tombe dans la boisson, on secoue, on boit.
- **Marque** : variable `BRAND_NAME`.
- **Visuel** : emplacement `/public/product.png`, avec une image de remplacement neutre.
- **Cible** : pratiquants de musculation, de powerlifting et de CrossFit en France.

## Langues
- FR (par défaut), EN, IT.
- Sélecteur de langue en haut de page ; la langue est détectée depuis le navigateur, avec repli sur le FR.
- Textes dans `fr.json` / `en.json` / `it.json`. Le README précise que les traductions doivent être relues par un locuteur natif.

## Parcours (honnête, sans dark pattern)
1. Page produit : visuel, bénéfice principal, prix, bouton « Précommander ».
2. Au clic : enregistrement de l'événement, puis message « Ce produit est en cours de développement et n'est pas encore en vente. Laisse ton e-mail pour être prévenu(e) du lancement. »
3. E-mail facultatif, avec une case NON pré-cochée : « J'accepte d'être contacté(e) au sujet du lancement. Mes données ne seront utilisées que pour ce projet étudiant et supprimées au plus tard le [date configurable]. »
4. Écran de remerciement avec un lien vers le questionnaire externe (URL configurable).

**INTERDIT** : fausse rupture de stock, faux compte à rebours, fausse rareté, collecte bancaire ou d'adresse postale, case pré-cochée.

## Test de prix
- Prix par défaut : [2.50, 3.50, 4.50] € la bouteille.
- `PRICE_MODE` peut valoir :
  - `random` : attribution uniforme à la première visite, mémorisée par `localStorage` et un identifiant anonyme ;
  - `schedule` : prix fixé par date, selon un calendrier.
- Le prix et le mode sont enregistrés avec chaque événement.

## Mesure
- Événements : `page_vue`, `clic_precommande`, `email_soumis`, `clic_questionnaire`.
- Champs de chaque événement : horodatage, identifiant anonyme aléatoire (pas d'empreinte navigateur), langue, prix, mode, source (UTM `utm_source` / `utm_medium` / `utm_campaign`, sinon `"direct"`).
- Pas de cookies tiers ni de Google Analytics.
- Les e-mails sont stockés séparément des événements (deux tables).
- Une bannière courte d'information renvoie vers une page Confidentialité (FR/EN/IT) qui indique : les responsables, le contact, la finalité, la durée de conservation et le droit de suppression.

## Admin
- `/admin`, protégé par un mot de passe en variable d'environnement.
- Indicateurs par prix et par source : visiteurs uniques, clics, taux de clic, e-mails, taux de conversion.
- Export CSV des événements (sans les e-mails), et export séparé des e-mails.

## Instagram
- Mobile d'abord.
- Balises Open Graph dans les trois langues.
- Le README explique comment construire des liens UTM pour `instagram_story`, `instagram_bio`, `salle_X` et `linkedin`.

## Sécurité
- Validation et limite de taille de toutes les entrées côté serveur, e-mail validé.
- Limite de requêtes par IP et champ piège invisible.
- En-têtes CSP, HSTS et X-Content-Type-Options. Aucun secret dans le dépôt. Requêtes paramétrées.

## Livrables
- Code et README en français, couvrant :
  - l'installation locale ;
  - le déploiement gratuit ;
  - la modification des prix et du calendrier ;
  - les liens UTM ;
  - la suppression des données.
- Tests automatisés couvrant : attribution aléatoire stable, mode calendrier, enregistrement des événements, consentement obligatoire, protection de `/admin`.
