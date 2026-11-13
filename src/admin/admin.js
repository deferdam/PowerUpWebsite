// Tableau de bord /admin. Aucun script inline (CSP) : tout est ici.
// Les données sont insérées avec textContent (jamais innerHTML) pour éviter toute injection.

const $ = (id) => document.getElementById(id);

const priceFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const pctFormat = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

function showMessage(text, isError = false) {
  const el = $('message');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.hidden = !text;
}

function showLogin() {
  $('dashboard').hidden = true;
  $('dashboard-actions').hidden = true;
  $('login-section').hidden = false;
  $('password').focus();
}

function showDashboard() {
  $('login-section').hidden = true;
  $('dashboard').hidden = false;
  $('dashboard-actions').hidden = false;
}

const pct = (value, visitors) => (visitors ? pctFormat.format(value) : '—');
const ci = (range, visitors) => (visitors ? `${pctFormat.format(range[0])} – ${pctFormat.format(range[1])}` : '—');

// Colonnes communes à tous les tableaux.
const COLUMNS = [
  ['Visiteurs', (r) => r.visitors],
  ['Clics', (r) => r.clickers],
  ['Taux de clic', (r) => pct(r.clickRate, r.visitors)],
  ['IC 95 % clic', (r) => ci(r.clickRateCI, r.visitors)],
  ['E-mails', (r) => r.emails],
  ['Conversion', (r) => pct(r.conversion, r.visitors)],
  ['IC 95 % conversion', (r) => ci(r.conversionCI, r.visitors)],
  ['Questionnaire', (r) => r.questionnaire],
];

function cell(tag, text) {
  const el = document.createElement(tag);
  el.textContent = String(text);
  return el;
}

/** Remplit un <table> : `keys` = colonnes d'identification (prix et/ou source). */
function renderTable(table, rows, keys) {
  table.replaceChildren();
  const head = document.createElement('tr');
  for (const [label] of keys) head.append(cell('th', label));
  for (const [label] of COLUMNS) head.append(cell('th', label));
  table.createTHead().append(head);

  const body = table.createTBody();
  if (rows.length === 0) {
    const tr = body.insertRow();
    const td = cell('td', 'Aucune donnée pour le moment.');
    td.colSpan = keys.length + COLUMNS.length;
    tr.append(td);
    return;
  }
  for (const row of rows) {
    const tr = body.insertRow();
    for (const [, get] of keys) tr.append(cell('td', get(row)));
    for (const [, get] of COLUMNS) tr.append(cell('td', get(row)));
  }
}

function renderKpis(total) {
  const items = [
    ['Visiteurs uniques', total.visitors],
    ['Taux de clic', pct(total.clickRate, total.visitors)],
    ['E-mails', total.emails],
    ['Conversion', pct(total.conversion, total.visitors)],
  ];
  $('kpis').replaceChildren(
    ...items.map(([label, value]) => {
      const box = document.createElement('div');
      box.className = 'kpi';
      box.append(cell('span', label), cell('strong', value));
      return box;
    }),
  );
}

const PRICE_COL = ['Prix', (r) => priceFormat.format(r.price)];
const SOURCE_COL = ['Source', (r) => r.source];

function render(stats) {
  const mode = stats.priceMode === 'schedule' ? 'calendrier' : 'aléatoire';
  $('meta').textContent = `Mode de prix : ${mode} · données du ${dateFormat.format(new Date(stats.generatedAt))}`;
  renderKpis(stats.total);
  renderTable($('table-price'), stats.byPrice, [PRICE_COL]);
  renderTable($('table-source'), stats.bySource, [SOURCE_COL]);
  renderTable($('table-rows'), stats.rows, [PRICE_COL, SOURCE_COL]);
}

async function loadStats() {
  let response;
  try {
    response = await fetch('/api/admin/stats', { cache: 'no-store' });
  } catch {
    return showMessage('Serveur injoignable. Vérifie ta connexion.', true);
  }
  if (response.status === 401) {
    showMessage('');
    return showLogin();
  }
  if (response.status === 503) {
    $('login-section').hidden = true;
    return showMessage(
      "Tableau de bord désactivé : ADMIN_PASSWORD (12 caractères min.) ou APP_SECRET (32 caractères min.) n'est pas configuré.",
      true,
    );
  }
  if (!response.ok) return showMessage('Erreur lors du chargement des statistiques.', true);

  showMessage('');
  render(await response.json());
  showDashboard();
}

async function postJson(url, data) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('password').value;
  let response;
  try {
    response = await postJson('/api/admin/login', { password });
  } catch {
    return showMessage('Serveur injoignable.', true);
  }
  $('password').value = '';
  if (response.status === 204) return loadStats();
  if (response.status === 429) return showMessage('Trop de tentatives. Réessaie dans 15 minutes.', true);
  if (response.status === 503) return showMessage("Connexion impossible : l'admin n'est pas configuré.", true);
  showMessage('Mot de passe incorrect.', true);
});

$('logout').addEventListener('click', async () => {
  try {
    await postJson('/api/admin/logout', {});
  } catch {
    // on affiche le formulaire quoi qu'il arrive
  }
  showMessage('Déconnecté.');
  showLogin();
});

$('refresh').addEventListener('click', loadStats);

loadStats();
