// Identifiant visiteur aléatoire (pseudonyme : ni nom ni e-mail), UTM « premier contact » et envoi des événements.
// Aucun cookie : tout est dans le localStorage du navigateur.
import { LS, VISITOR_TTL_MS, UUID_V4_RE } from '../../shared/constants.js';

// localStorage peut être indisponible (navigation privée, réglages) : on ne plante jamais.
export const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignoré */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignoré */
    }
  },
};

function newUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Repli (contexte non sécurisé) : UUID v4 à partir d'octets aléatoires.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let memoryId = null; // utilisé si localStorage ne marche pas

/** Identifiant aléatoire du visiteur, renouvelé après VISITOR_TTL_MS (13 mois). */
export function getVisitorId() {
  if (memoryId) return memoryId;
  try {
    const saved = JSON.parse(storage.get(LS.visitor) || 'null');
    if (saved && UUID_V4_RE.test(saved.id) && Date.now() - saved.created < VISITOR_TTL_MS) return saved.id;
  } catch {
    /* valeur abîmée : on en recrée une */
  }
  const id = newUuid();
  storage.set(LS.visitor, JSON.stringify({ id, created: Date.now() }));
  if (storage.get(LS.visitor) === null) memoryId = id;
  return id;
}

/** ?interne=1 → l'équipe n'est pas comptée ; ?interne=0 → on recompte. */
export function applyOptOutParam() {
  const value = new URLSearchParams(location.search).get('interne');
  if (value === '1') storage.set(LS.optout, '1');
  if (value === '0') storage.remove(LS.optout);
}

/** UTM du premier contact : lus à la première visite, jamais écrasés ensuite. */
export function getUtm() {
  try {
    const saved = JSON.parse(storage.get(LS.utm) || 'null');
    if (saved && typeof saved === 'object') return saved;
  } catch {
    /* ignoré */
  }
  const params = new URLSearchParams(location.search);
  const utm = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const value = params.get(key);
    if (value) utm[key] = value.toLowerCase().slice(0, 64);
  }
  storage.set(LS.utm, JSON.stringify(utm));
  return utm;
}

export function lang() {
  return document.documentElement.lang || 'fr';
}

/** Envoie un événement (page_vue, clic_precommande, clic_questionnaire). Erreurs ignorées. */
export function track(event) {
  if (storage.get(LS.optout) === '1') return;
  const body = JSON.stringify({ visitorId: getVisitorId(), event, lang: lang(), ...getUtm() });
  fetch('/api/event', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => {});
}
