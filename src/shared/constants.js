// Module partagé navigateur + serveur.
export const LANGS = ['fr', 'en', 'it'];
export const DEFAULT_LANG = 'fr';

// Événements envoyés par le navigateur vers POST /api/event
export const CLIENT_EVENTS = ['page_vue', 'clic_precommande', 'clic_questionnaire'];
// email_soumis est écrit UNIQUEMENT par le serveur (POST /api/email), jamais par /api/event
export const ALL_EVENTS = [...CLIENT_EVENTS, 'email_soumis'];

export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const UTM_RE = /^[a-z0-9_.-]{1,64}$/;
export const MAX_BODY_BYTES = 2048;
export const MAX_EMAIL_LENGTH = 254;

// Clés localStorage côté navigateur
export const LS = {
  visitor: 'pu_vid', // {"id": uuid, "created": ms} — renouvelé après 395 jours (13 mois)
  utm: 'pu_utm', // {"utm_source","utm_medium","utm_campaign"} premier contact
  lang: 'pu_lang', // langue choisie manuellement
  optout: 'pu_optout', // "1" = visite de l'équipe, aucun événement envoyé (?interne=1 / ?interne=0)
  banner: 'pu_banner_ok', // "1" = bannière d'information fermée
};
export const VISITOR_TTL_MS = 395 * 24 * 3600 * 1000;
