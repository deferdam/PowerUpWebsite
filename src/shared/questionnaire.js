// Lien vers le questionnaire Tally, complété avec ses champs cachés :
//   p    = prix affiché au visiteur, au format de sa langue (« 12 », « 3,50 » ou « 3.50 »),
//          repris dans la question « À … €, achèterais-tu cette bouteille ? »
//   arm  = ce même prix en centimes (350), pour les analyses
//   lang = langue du site (fr, en, it)
//   src  = « site_ » + source UTM de la visite, ou « site_direct »
// Aucun identifiant visiteur n'est transmis : les réponses ne sont pas reliables aux statistiques.

/**
 * @param {string | Record<string, string>} base  QUESTIONNAIRE_URL : une URL, ou une URL par langue
 * @returns {string} l'URL complète, ou '' si aucun questionnaire n'est configuré pour cette langue
 */
export function questionnaireUrl(base, { lang, priceCents, source }) {
  const raw = typeof base === 'string' ? base : (base && base[lang]) || '';
  if (!raw) return '';
  const url = new URL(raw);
  const digits = priceCents % 100 === 0 ? 0 : 2; // même écriture que sur le site
  const price = new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
  url.searchParams.set('p', price.format(priceCents / 100));
  url.searchParams.set('arm', String(priceCents));
  url.searchParams.set('lang', lang);
  url.searchParams.set('src', `site_${source || 'direct'}`);
  return url.toString();
}
