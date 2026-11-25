// Point d'entrée du site public. Ce fichier reste léger (premier affichage rapide) :
// Three.js et la scène 3D sont chargés plus tard, dans un fichier séparé.
import * as config from '/assets/site-config.js';
import { priceFor } from '../../shared/pricing.js';
import { applyOptOutParam, getVisitorId, track, lang } from './track.js';
import { redirectIfNeeded, initLangLinks } from './lang.js';
import { initPreorder } from './preorder.js';
import { initBanner, initReveal, initStickyBar, initHeader, initMagnetic, initOptOut, reducedMotion } from './ui.js';
import { initStory } from './story.js';

applyOptOutParam();
if (!redirectIfNeeded()) boot();

function boot() {
  const isHome = document.body.dataset.page === 'home';
  initLangLinks();
  initBanner();
  initHeader();
  initReveal();
  initOptOut(); // page Confidentialité uniquement
  if (!isHome) return;

  track('page_vue');
  const priceCents = showPrice();
  initPreorder({ questionnaire: config.QUESTIONNAIRE_URL, priceCents });
  initStickyBar();
  initMagnetic();

  // Pont vers la scène 3D : tant qu'elle n'est pas chargée, les appels ne font rien.
  const scene = {
    api: null,
    call(name, ...args) {
      if (this.api && this.api[name]) this.api[name](...args);
    },
  };
  const story = initStory(scene);
  load3d(scene, story);
}

/** Affiche le prix du visiteur (même calcul que le serveur). */
function showPrice() {
  const { priceCents } = priceFor(config, getVisitorId());
  const whole = priceCents % 100 === 0; // « 12 € » plutôt que « 12,00 € »
  const text = new Intl.NumberFormat(lang(), {
    style: 'currency',
    currency: config.CURRENCY,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(priceCents / 100);
  for (const el of document.querySelectorAll('[data-price]')) el.textContent = text;
  return priceCents;
}

/** Charge la 3D après le premier affichage, quand le navigateur est libre. */
function load3d(scene, story) {
  const canvas = document.querySelector('.gl');
  if (!canvas) return;
  const zones = [...document.querySelectorAll('[data-zone]')];
  // En attendant la 3D, le hero n'affiche pas l'image de repli (une bouteille) : la page
  // doit s'ouvrir sur la dosette seule. Si la 3D échoue, l'image revient.
  const root = document.documentElement;
  if (window.WebGLRenderingContext) root.classList.add('is-3d-pending');
  let introPlayed = false; // l'intro ne rejoue pas au retour par le bouton « précédent »

  const start = async () => {
    if (scene.api) return;
    try {
      const { createStage } = await import('./scene/stage.js');
      scene.api = await createStage({
        canvas,
        zones,
        reducedMotion: reducedMotion.matches,
        intro: !introPlayed,
        label: { brand: config.BRAND_NAME, ...canvas.dataset },
      });
      introPlayed = true;
      scene.api.setChapter(story.chapter);
      scene.api.jumpTo(story.phase);
      root.classList.add('has-3d');
      root.classList.remove('is-3d-pending');
      setZonesInteractive(zones, true);
    } catch (err) {
      // Pas de WebGL ou fichier non chargé : l'image de repli reste affichée.
      scene.api = null;
      root.classList.remove('has-3d', 'is-3d-pending');
      setZonesInteractive(zones, false);
      if (location.hostname === 'localhost') console.warn('3D indisponible :', err);
    }
  };

  const whenIdle = () => (window.requestIdleCallback ? requestIdleCallback(start, { timeout: 2500 }) : setTimeout(start, 300));
  if (document.readyState === 'complete') whenIdle();
  else addEventListener('load', whenIdle, { once: true });

  // On libère la carte graphique en quittant la page, et on recharge au retour (cache « précédent »).
  addEventListener('pagehide', () => {
    if (scene.api) scene.api.dispose();
    scene.api = null;
    document.documentElement.classList.remove('has-3d');
    setZonesInteractive(zones, false);
  });
  addEventListener('pageshow', (e) => {
    if (e.persisted) start();
  });
}

/**
 * Zones 3D : focusables au clavier (flèches gauche/droite) seulement quand la 3D tourne.
 * Sans 3D, ce sont de simples images, sans arrêt de tabulation ni consigne clavier.
 */
function setZonesInteractive(zones, on) {
  for (const zone of zones) {
    if (!zone.dataset.alt) zone.dataset.alt = zone.getAttribute('aria-label') || '';
    zone.setAttribute('role', on ? 'application' : 'img');
    zone.setAttribute('aria-label', on ? `${zone.dataset.alt} ${zone.dataset.keys || ''}`.trim() : zone.dataset.alt);
    if (on) zone.tabIndex = 0;
    else zone.removeAttribute('tabindex');
  }
}
