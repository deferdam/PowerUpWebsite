// =====================================================================
//  CONFIGURATION DU SITE — c'est le SEUL fichier à modifier pour :
//  la marque, les prix, le mode de test de prix, le calendrier,
//  le questionnaire, le contact et la date de suppression des données.
//  Après modification : commit + push → Vercel redéploie tout seul.
//  Aucun secret ici (le dépôt est public) : les secrets vont dans les
//  variables d'environnement Vercel (voir .env.example).
// =====================================================================

const env = typeof process !== 'undefined' && process.env ? process.env : {};

export const BRAND_NAME = 'UPKAP'; // recherche INPI faite (0 marque UPKAP). Pour changer le nom : modifier ici, commit, push.

// "random"   : chaque visiteur reçoit au hasard un des prix de PRICES, toujours le même pour lui.
// "schedule" : le prix dépend de la date (heure de Paris), selon PRICE_SCHEDULE.
export const PRICE_MODE = 'random';

// Prix testés, en euros par bouteille.
export const PRICES = [2.5, 3.5, 4.5];

// Utilisé seulement si PRICE_MODE = "schedule".
// Chaque ligne : à partir de cette date (incluse, heure de Paris), ce prix s'applique.
// Avant la 1re date : 1er prix. Après la dernière : dernier prix. Les prix doivent figurer dans PRICES.
export const PRICE_SCHEDULE = [
  { from: '2026-11-16', price: 2.5 }, // semaine 1
  { from: '2026-11-23', price: 3.5 }, // semaine 2
  { from: '2026-11-30', price: 4.5 }, // semaine 3
];

export const CURRENCY = 'EUR';

// Questionnaire externe (Tally) affiché sur l'écran de remerciement, une version par langue.
// Le site ajoute tout seul au lien le prix vu par le visiteur, la langue et la source (champs cachés p, arm, lang, src).
// Les liens doivent commencer par https://. Mettre '' pour masquer le lien.
export const QUESTIONNAIRE_URL = {
  fr: 'https://tally.so/r/Ge92Wo',
  en: 'https://tally.so/r/Kp57pk',
  it: 'https://tally.so/r/5Xj6XP',
};

// Contact affiché sur les pages Confidentialité et Mentions légales.
export const CONTACT_EMAIL = 'damien.defer@proton.me';

// Éditeur du site ET responsable de traitement (mentions légales + page Confidentialité).
// Ajouter les prénoms et noms des autres membres de l'équipe quand ils sont connus.
export const PUBLISHER = "Damien Defer et l'équipe projet UPKAP — étudiants ESCP Business School (Option Entrepreneuriat)";

// Directeur de la publication (LCEN art. 6-III) : une personne physique nommée.
export const PUBLICATION_DIRECTOR = 'Damien Defer';

// Date limite de suppression de toutes les données (format AAAA-MM-JJ).
export const DATA_DELETION_DATE = '2027-06-30';

// URL publique du site (pour les balises Open Graph). Sur Vercel, détectée automatiquement.
export const SITE_URL =
  env.SITE_URL ||
  (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');

export default {
  BRAND_NAME,
  PRICE_MODE,
  PRICES,
  PRICE_SCHEDULE,
  CURRENCY,
  QUESTIONNAIRE_URL,
  CONTACT_EMAIL,
  PUBLISHER,
  PUBLICATION_DIRECTOR,
  DATA_DELETION_DATE,
  SITE_URL,
};
