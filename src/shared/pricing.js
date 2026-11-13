// Module partagé navigateur + serveur (aucun import Node). Pur et déterministe.
// Le serveur RECALCULE toujours le prix avec ce module : il ne fait jamais
// confiance au prix envoyé par le navigateur.

/** FNV-1a 32 bits suivi du mélange final de MurmurHash3 (meilleure répartition des bits bas). */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Date du jour au format AAAA-MM-JJ, à l'heure de Paris. */
export function parisDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Prix en centimes (entier) pour éviter les erreurs d'arrondi. */
export function toCents(price) {
  return Math.round(price * 100);
}

/**
 * Prix vu par un visiteur.
 * @param {{PRICE_MODE:string, PRICES:number[], PRICE_SCHEDULE:{from:string, price:number}[]}} config
 * @param {string} visitorId UUID v4 aléatoire du visiteur
 * @param {Date} [date]
 * @returns {{priceCents:number, mode:'random'|'schedule'}}
 */
export function priceFor(config, visitorId, date = new Date()) {
  if (config.PRICE_MODE === 'schedule') {
    const day = parisDay(date);
    const sched = [...config.PRICE_SCHEDULE].sort((a, b) => (a.from < b.from ? -1 : 1));
    let price = sched[0].price;
    for (const row of sched) if (row.from <= day) price = row.price;
    return { priceCents: toCents(price), mode: 'schedule' };
  }
  const idx = hash32(String(visitorId)) % config.PRICES.length;
  return { priceCents: toCents(config.PRICES[idx]), mode: 'random' };
}
