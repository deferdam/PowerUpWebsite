// Langue : redirection automatique depuis la page FR et sélecteur de langue.
import { LS, LANGS } from '../../shared/constants.js';
import { storage } from './track.js';

/**
 * Sur la page d'accueil FR uniquement : si le visiteur n'a jamais choisi de langue
 * et que son navigateur préfère l'anglais ou l'italien (avant le français), on redirige.
 * @returns {boolean} true si une redirection est lancée
 */
export function redirectIfNeeded() {
  if (document.documentElement.lang !== 'fr' || location.pathname !== '/') return false;
  if (storage.get(LS.lang)) return false;
  // Le lien « FR » du sélecteur mène à /?lang=fr : le choix est respecté
  // même si le localStorage est indisponible (il ne peut alors rien mémoriser).
  if (new URLSearchParams(location.search).get('lang') === 'fr') return false;
  const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'fr'];
  for (const pref of prefs) {
    const code = String(pref).slice(0, 2).toLowerCase();
    if (code === 'fr') return false;
    if (LANGS.includes(code)) {
      // Pas de « / » final : vercel.json a trailingSlash:false (sinon redirection 308 en plus).
      location.replace(`/${code}` + location.search);
      return true;
    }
  }
  return false;
}

/** Les liens FR/EN/IT gardent les paramètres de l'URL (UTM…) et mémorisent le choix. */
export function initLangLinks() {
  const current = new URLSearchParams(location.search);
  for (const link of document.querySelectorAll('[data-lang-link]')) {
    if (location.search) {
      const url = new URL(link.getAttribute('href'), location.href);
      for (const [key, value] of current) {
        // « lang » ne concerne que le lien FR (déjà dans son href) : on ne le recopie pas.
        if (key !== 'lang' && !url.searchParams.has(key)) url.searchParams.set(key, value);
      }
      link.href = url.pathname + url.search;
    }
    link.addEventListener('click', () => storage.set(LS.lang, link.dataset.langLink));
  }
}
