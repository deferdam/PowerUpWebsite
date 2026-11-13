// Statistiques du tableau de bord : agrégation SQL + intervalles de confiance de Wilson à 95 %.
import { getDb } from './db.js';

const Z95 = 1.959964; // quantile de la loi normale pour 95 %

/**
 * Intervalle de Wilson à 95 % pour une proportion k / n.
 * Plus fiable que « p ± 1,96 × écart-type » quand l'échantillon est petit ou que p est proche de 0.
 * @returns {[number, number]} [borne basse, borne haute] ; [0, 1] si n = 0 (aucune information)
 */
export function wilson(k, n) {
  if (!n) return [0, 1];
  const p = Math.min(k, n) / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

// Visiteurs distincts par type d'événement (un visiteur compte une seule fois par groupe).
const COUNTS = `
  COUNT(DISTINCT CASE WHEN event = 'page_vue' THEN visitor_id END) AS visitors,
  COUNT(DISTINCT CASE WHEN event = 'clic_precommande' THEN visitor_id END) AS clickers,
  COUNT(DISTINCT CASE WHEN event = 'email_soumis' THEN visitor_id END) AS emails,
  COUNT(DISTINCT CASE WHEN event = 'clic_questionnaire' THEN visitor_id END) AS questionnaire`;

// Les 4 niveaux de regroupement : du SQL constant, aucune donnée utilisateur n'y est insérée.
const SQL_ROWS = `SELECT price_cents, source, ${COUNTS} FROM events GROUP BY price_cents, source ORDER BY price_cents, source`;
const SQL_BY_PRICE = `SELECT price_cents, ${COUNTS} FROM events GROUP BY price_cents ORDER BY price_cents`;
const SQL_BY_SOURCE = `SELECT source, ${COUNTS} FROM events GROUP BY source ORDER BY source`;
const SQL_TOTAL = `SELECT ${COUNTS} FROM events`;

/** Transforme une ligne SQL en ligne du tableau de bord (taux + intervalles). */
function toRow(r) {
  const visitors = Number(r.visitors);
  const clickers = Number(r.clickers);
  const emails = Number(r.emails);
  return {
    price: r.price_cents === undefined ? null : Number(r.price_cents) / 100,
    source: r.source === undefined ? '*' : r.source,
    visitors,
    clickers,
    clickRate: visitors ? clickers / visitors : 0,
    emails,
    conversion: visitors ? emails / visitors : 0,
    clickRateCI: wilson(clickers, visitors),
    conversionCI: wilson(emails, visitors),
    questionnaire: Number(r.questionnaire),
  };
}

/** Calcule toutes les statistiques affichées sur /admin. */
export async function computeStats(priceMode) {
  const db = await getDb();
  const rows = await db.execute(SQL_ROWS);
  const byPrice = await db.execute(SQL_BY_PRICE);
  const bySource = await db.execute(SQL_BY_SOURCE);
  const total = await db.execute(SQL_TOTAL);
  return {
    generatedAt: new Date().toISOString(),
    priceMode,
    rows: rows.rows.map(toRow),
    byPrice: byPrice.rows.map(toRow),
    bySource: bySource.rows.map(toRow),
    total: toRow(total.rows[0]),
  };
}
