# Registre des activités de traitement (RGPD art. 30)

Projet étudiant ESCP Business School, Option Entrepreneuriat. Test d'intention d'achat (« fake door test »).
Version du 16/11/2026. Mettre ce registre à jour à chaque changement : nouvelle donnée, nouveau prestataire, nouvelle date.

## Responsable de traitement

| | |
|---|---|
| Responsables | Damien Defer et l'équipe projet, étudiants ESCP Business School (Option Entrepreneuriat). Ajouter ici les noms des autres membres. |
| Contact | damien.defer@proton.me |
| Délégué à la protection des données (DPO) | Aucun (non obligatoire pour ce projet) |
| Encadrement | Préciser l'enseignant encadrant ESCP si l'école demande d'apparaître comme co-responsable |

---

## Traitement n° 1 : mesure d'audience du test de prix

| Rubrique | Contenu |
|---|---|
| Finalité | Mesurer l'intérêt pour le produit selon le prix affiché et la source du visiteur (statistiques agrégées pour le projet) |
| Base légale | Intérêt légitime (art. 6.1.f) : mesure pseudonyme, limitée au site, sans publicité ni profilage |
| Personnes concernées | Visiteurs du site |
| Données | Identifiant aléatoire stocké dans le navigateur (`localStorage`, renouvelé au bout de 13 mois). Événements : page vue, clic « Précommander », e-mail laissé (sans l'adresse), clic questionnaire. Horodatage, langue, prix affiché, mode de prix, paramètres UTM. |
| Données exclues | Pas de cookie, pas d'adresse IP en clair, pas d'empreinte du navigateur, pas de Google Analytics |
| Destinataires | Équipe projet uniquement (accès à `/admin` protégé par mot de passe) |
| Sous-traitants | Vercel Inc. (hébergement, États-Unis, encadré par le Data Privacy Framework). Turso / ChiselStrike Inc. (base de données, instance en région UE) |
| Transferts hors UE | Vercel (DPF UE–États-Unis) |
| Durée de conservation | Jusqu'au 30/06/2027 au plus tard, puis suppression (`npm run purge:all -- --yes`) |
| Sécurité | HTTPS/HSTS, CSP stricte, requêtes SQL paramétrées, admin protégé (mot de passe en variable d'environnement, cookie signé), limitation de débit, aucun secret dans le dépôt |

## Traitement n° 2 : liste de contact pour le lancement

| Rubrique | Contenu |
|---|---|
| Finalité | Prévenir du lancement du produit les personnes qui l'ont demandé |
| Base légale | Consentement (art. 6.1.a) : case non pré-cochée, obligatoire pour envoyer l'adresse, texte daté |
| Personnes concernées | Visiteurs qui laissent volontairement leur e-mail |
| Données | Adresse e-mail, langue, date du consentement (au jour près), date d'inscription |
| Séparation | Table `emails` séparée des statistiques : aucun identifiant visiteur ni prix. Les dates sont arrondies au jour pour qu'on ne puisse pas relier une adresse à un parcours. |
| Destinataires | Équipe projet uniquement. Aucune revente ni transmission à des tiers. |
| Sous-traitants | Vercel (hébergement), Turso (base en UE) |
| Durée de conservation | Jusqu'au 30/06/2027 au plus tard (`npm run purge:emails -- --yes`), ou plus tôt sur demande |
| Retrait du consentement | Par e-mail au contact ci-dessus : suppression sous un mois |

## Traitement n° 3 : protection contre le spam (limitation de débit)

| Rubrique | Contenu |
|---|---|
| Finalité | Empêcher les envois automatisés et les tentatives de connexion à l'admin |
| Base légale | Intérêt légitime (sécurité du service) |
| Données | Empreinte HMAC de l'adresse IP (non réversible sans le secret serveur) et un compteur, par fenêtre de temps |
| Durée de conservation | 24 heures au plus (purge automatique) |

## Traitement n° 4 : questionnaire d'étude (Tally)

| Rubrique | Contenu |
|---|---|
| Finalité | Étude de marché du projet : habitudes de consommation de compléments sportifs et intention d'achat selon le prix |
| Base légale | Consentement (art. 6.1.a), recueilli sur la première page du questionnaire ; réservé aux personnes majeures |
| Personnes concernées | Visiteurs qui ouvrent volontairement le questionnaire (depuis le site ou un lien direct) |
| Données | Réponses au questionnaire. Champs cachés transmis par le site : langue, prix affiché (`p`, `arm`), source (`src`). Aucun identifiant visiteur, aucune adresse e-mail : réponses non reliables aux statistiques du site |
| Sous-traitant | Tally BV (Belgique, UE) |
| Durée de conservation | Jusqu'au 10/12/2026 au plus tard (date annoncée en tête des questionnaires), puis suppression des formulaires et réponses dans Tally |
| Note | Le formulaire e-mail séparé (entretien de 15 minutes) relève du même principe : consentement, table distincte des réponses |

---

## Procédures

- **Demande d'accès ou de suppression** (réponse sous un mois au plus tard) :
  1. Chercher l'adresse dans la console SQL de Turso : `SELECT * FROM emails WHERE email = 'adresse@exemple.fr';`
  2. La supprimer : `DELETE FROM emails WHERE email = 'adresse@exemple.fr';`
  3. Répondre à la personne pour confirmer.
  4. Les statistiques ne contiennent aucune adresse : il n'y a rien d'autre à supprimer.
- **Violation de données** (base exposée, mot de passe admin divulgué) :
  1. Changer `ADMIN_PASSWORD` et `APP_SECRET` sur Vercel, puis redéployer.
  2. Prévenir l'encadrant.
  3. Évaluer s'il faut notifier la CNIL sous 72 h (art. 33).
- **Fin du projet** :
  1. Lancer `npm run purge:all -- --yes`, ou supprimer la base Turso.
  2. Supprimer le projet Vercel et les formulaires Tally (avec leurs réponses).
  3. Noter ici la date de suppression effective : ____ / ____ / ______
