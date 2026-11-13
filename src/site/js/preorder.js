// Bouton « Précommander » → enregistre le clic, ouvre la fenêtre honnête,
// puis envoie (si la personne le veut) son e-mail avec son consentement.
import { track, getVisitorId, getUtm, lang } from './track.js';

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function initPreorder({ questionnaireUrl }) {
  const dialog = document.querySelector('[data-dialog]');
  if (!dialog) return;
  const form = dialog.querySelector('[data-form]');
  const status = dialog.querySelector('[data-status]');
  const submit = dialog.querySelector('[data-submit]');
  const views = {
    form: dialog.querySelector('[data-view="form"]'),
    success: dialog.querySelector('[data-view="success"]'),
  };
  let done = false; // e-mail déjà envoyé pendant cette visite

  // Lien vers le questionnaire : affiché seulement s'il est configuré.
  const qWrap = dialog.querySelector('[data-questionnaire]');
  const qLink = dialog.querySelector('[data-questionnaire-link]');
  if (questionnaireUrl && qWrap && qLink) {
    qLink.href = questionnaireUrl;
    qWrap.hidden = false;
    qLink.addEventListener('click', () => track('clic_questionnaire'));
  }

  function show(name) {
    views.form.hidden = name !== 'form';
    views.success.hidden = name !== 'success';
    const title = views[name].querySelector('.dialog__title');
    if (title) title.focus();
  }

  function open() {
    track('clic_precommande');
    status.textContent = '';
    if (!dialog.open) dialog.showModal();
    show(done ? 'success' : 'form');
  }

  // Tous les boutons « Précommander » de la page
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preorder]');
    if (button) open();
  });

  // « Non merci », croix, « Fermer »
  for (const btn of dialog.querySelectorAll('[data-close]')) btn.addEventListener('click', () => dialog.close());
  // Clic sur le fond assombri : ferme aussi.
  // Un clic dans la marge intérieure de la fenêtre a aussi `dialog` pour cible :
  // on vérifie donc que le clic est bien EN DEHORS du rectangle de la fenêtre.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const outside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    if (outside) dialog.close();
  });

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('is-error', Boolean(isError));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const msgs = form.dataset;
    if (!EMAIL_RE.test(email) || email.length > 254) {
      setStatus(msgs.errInvalidEmail, true);
      form.email.focus();
      return;
    }
    if (!form.consent.checked) {
      setStatus(msgs.errConsent, true);
      form.consent.focus();
      return;
    }

    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    setStatus(msgs.sending, false);
    try {
      const res = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          consent: true,
          website: form.website.value,
          visitorId: getVisitorId(),
          lang: lang(),
          ...getUtm(),
        }),
      });
      if (res.ok) {
        done = true;
        form.reset();
        setStatus('', false);
        show('success');
        return;
      }
      let code = '';
      try {
        code = (await res.json()).error || '';
      } catch {
        /* réponse sans JSON */
      }
      if (res.status === 429) setStatus(msgs.errRate, true);
      else if (code === 'invalid_email') setStatus(msgs.errInvalidEmail, true);
      else if (code === 'consent_required') setStatus(msgs.errConsent, true);
      else setStatus(msgs.errGeneric, true);
    } catch {
      setStatus(msgs.errNetwork, true);
    } finally {
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}
