// Petits comportements d'interface : bannière, apparitions au scroll,
// barre d'achat mobile, en-tête, effet « aimant » sur les boutons.
import { LS } from '../../shared/constants.js';
import { storage } from './track.js';

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Bannière d'information (pas un mur de consentement : rien n'est bloqué). */
export function initBanner() {
  const banner = document.querySelector('[data-banner]');
  if (!banner || storage.get(LS.banner) === '1') return;
  banner.hidden = false;
  document.body.classList.add('has-banner');
  banner.querySelector('[data-banner-ok]').addEventListener('click', () => {
    storage.set(LS.banner, '1');
    banner.hidden = true;
    document.body.classList.remove('has-banner');
  });
}

/**
 * Page Confidentialité : boutons « Ne plus être mesuré » / « Réactiver la mesure ».
 * Le choix est enregistré dans LS.optout ; track() n'envoie plus rien quand il vaut "1".
 */
export function initOptOut() {
  const box = document.querySelector('[data-optout]');
  if (!box) return;
  const state = box.querySelector('[data-optout-state]');
  const stopBtn = box.querySelector('[data-optout-stop]');
  const resumeBtn = box.querySelector('[data-optout-resume]');

  const render = (wanted) => {
    const off = storage.get(LS.optout) === '1';
    // Stockage bloqué par le navigateur : le choix n'a pas pu être enregistré.
    const failed = wanted !== undefined && wanted !== off;
    state.textContent = failed ? state.dataset.failed : off ? state.dataset.off : state.dataset.on;
    stopBtn.hidden = off;
    resumeBtn.hidden = !off;
  };

  stopBtn.addEventListener('click', () => {
    storage.set(LS.optout, '1');
    render(true);
    if (!resumeBtn.hidden) resumeBtn.focus(); // le bouton cliqué disparaît : on garde le focus
  });
  resumeBtn.addEventListener('click', () => {
    storage.remove(LS.optout);
    render(false);
    if (!stopBtn.hidden) stopBtn.focus();
  });

  box.hidden = false;
  render();
}

/** Les éléments .reveal apparaissent quand ils entrent dans l'écran. */
export function initReveal() {
  const items = document.querySelectorAll('.reveal');
  document.documentElement.classList.add('reveal-ready');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  items.forEach((el) => io.observe(el));
}

/**
 * Barre « prix + Précommander » en bas sur mobile.
 * Visible dès l'arrivée (sur téléphone, le prix du hero est sous la ligne de flottaison),
 * cachée quand un autre bouton « Précommander » est déjà à l'écran (hero, appel final)
 * et pendant « Explore l'objet » (elle couvrirait les onglets des chapitres).
 */
export function initStickyBar() {
  const bar = document.querySelector('[data-bar]');
  if (!bar || !('IntersectionObserver' in window)) return;
  const targets = ['[data-hero] .buy', '[data-explore]', '[data-final]']
    .map((selector) => document.querySelector(selector))
    .filter(Boolean);
  const onScreen = new Set();
  const update = () => {
    const visible = onScreen.size === 0;
    bar.classList.toggle('is-visible', visible);
    bar.inert = !visible;
    document.body.classList.toggle('has-bar', visible);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) onScreen.add(e.target);
      else onScreen.delete(e.target);
    }
    update();
  });
  targets.forEach((el) => io.observe(el));
}

/** L'en-tête prend un fond dès qu'on a un peu défilé. */
export function initHeader() {
  const header = document.querySelector('[data-header]');
  if (!header) return;
  let ticking = false;
  const update = () => {
    header.classList.toggle('is-scrolled', scrollY > 8);
    ticking = false;
  };
  addEventListener(
    'scroll',
    () => {
      if (!ticking) requestAnimationFrame(update);
      ticking = true;
    },
    { passive: true },
  );
  update();
}

/** Effet « aimant » : le bouton suit légèrement la souris (souris uniquement). */
export function initMagnetic() {
  if (reducedMotion.matches || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  for (const el of document.querySelectorAll('.cta--magnetic')) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.22;
      const y = (e.clientY - r.top - r.height / 2) * 0.35;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transform = '';
    });
  }
}
