// Génération de fichiers CSV (RFC 4180) protégés contre l'injection de formules (Excel, Google Sheets).

/** Une cellule : neutralise les formules (= + - @ tabulation, retour chariot), puis échappe les guillemets. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Fichier complet : BOM UTF-8 (pour qu'Excel affiche bien les accents), en-tête, lignes séparées par CRLF. */
export function toCsv(header, rows) {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Réponse HTTP qui déclenche le téléchargement du fichier. */
export function csvResponse(filename, csvText) {
  return new Response(csvText, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
