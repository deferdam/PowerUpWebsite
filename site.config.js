// =====================================================================
//  CONFIGURATION DU SITE — c'est le SEUL fichier à modifier pour :
//  la marque, les prix, le mode de test de prix, le calendrier,
//  le questionnaire, le contact et la date de suppression des données.
//  Après modification : commit + push → Vercel redéploie tout seul.
//  Aucun secret ici (le dépôt est public) : les secrets vont dans les
//  variables d'environnement Vercel (voir .env.example).
// =====================================================================

const env = typeof process !== 'undefined' && process.env ? process.env : {};

export const BRAND_NAME = 'PowerUp'; // nom provisoire : vérifier la disponibilité sur INPI / EUIPO avant lancement

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

// Lien du questionnaire externe affiché sur l'écran de remerciement.
// Laisser vide ('') tant qu'il n'existe pas : le lien est alors masqué. Doit commencer par https://
export const QUESTIONNAIRE_URL = '';

// Contact affiché sur les pages Confidentialité et Mentions légales.
export const CONTACT_EMAIL = 'damien.defer@proton.me';

// Éditeur du site ET responsable de traitement (mentions légales + page Confidentialité).
// OBLIGATOIRE avant la mise en ligne : prénoms et noms des membres de l'équipe
// (RGPD art. 13 et LCEN art. 6-III), par exemple :
// 'Prénom NOM, Prénom NOM — étudiants ESCP Business School, projet PowerUp'
export const PUBLISHER = 'Équipe projet PowerUp — étudiants ESCP Business School (Option Entrepreneuriat)';

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
  DATA_DELETION_DATE,
  SITE_URL,
};
