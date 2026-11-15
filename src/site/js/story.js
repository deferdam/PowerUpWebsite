// Chapitres « Explore l'objet » et démo « Apprendre en faisant ».
// Ce module gère la logique et l'interface. La 3D (si elle est chargée) suit,
// via l'objet `scene` : scene.call('nomDeMéthode', ...arguments).
// Sans 3D, la démo marche quand même (image de repli animée en CSS / Web Animations).
import { reducedMotion } from './ui.js';

const PHASES = ['press', 'shake', 'drink', 'done'];
const HOLD_MS = 900; // durée d'appui pour percer la membrane

export function initStory(scene) {
  const story = { chapter: 0, phase: 'press' };
  initChapters(scene, story);
  initDemo(scene, story);
  return story;
}

// ---------------------------------------------------------------------
//  Chapitres : le scroll (ou les onglets) choisit l'angle de la bouteille
// ---------------------------------------------------------------------
function initChapters(scene, story) {
  const tabs = [...document.querySelectorAll('[data-chapter-tab]')];
  const chapters = [...document.querySelectorAll('[data-chapter]')];
  const num = document.querySelector('[data-chapter-num]');
  const fill = document.querySelector('[data-tabs-fill]');
  if (!chapters.length) return;

  function setChapter(i) {
    story.chapter = i;
    tabs.forEach((tab, j) => tab.setAttribute('aria-current', String(i === j)));
    chapters.forEach((c, j) => c.classList.toggle('is-active', i === j));
    if (num) num.textContent = String(i + 1).padStart(2, '0');
    if (fill) fill.style.transform = `scaleX(${(i + 1) / chapters.length})`;
    scene.call('setChapter', i);
  }

  // Téléphone / tablette (< 1024 px, même seuil que le CSS) : les cartes défilent à
  // l'horizontale sous la bouteille. Ordinateur : elles défilent à la verticale.
  const narrow = matchMedia('(max-width: 1023px)');
  const scroller = document.querySelector('.explore__chapters');
  const behavior = () => (reducedMotion.matches ? 'auto' : 'smooth');

  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      const i = Number(tab.dataset.chapterTab);
      setChapter(i);
      if (narrow.matches && scroller) {
        // scrollIntoView ferait aussi défiler la page à la verticale
        const pad = parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
        lock = i; // pendant le défilement animé, on ne repasse pas par les cartes intermédiaires
        clearTimeout(lockTimer);
        lockTimer = setTimeout(() => (lock = null), 1200);
        scroller.scrollTo({ left: chapters[i].offsetLeft - pad, behavior: behavior() });
      } else {
        chapters[i].scrollIntoView({ behavior: behavior(), block: 'center' });
      }
    }),
  );

  // Ordinateur : le chapitre « actif » est celui qui passe au milieu de l'écran.
  const io = new IntersectionObserver(
    (entries) => {
      if (narrow.matches) return;
      for (const e of entries) if (e.isIntersecting) setChapter(Number(e.target.dataset.chapter));
    },
    { rootMargin: '-48% 0px -48% 0px' },
  );
  chapters.forEach((c) => io.observe(c));

  // Mobile : la carte « active » est celle qui est calée à gauche dans la rangée.
  let ticking = false;
  let lock = null;
  let lockTimer = 0;
  function fromScroll() {
    ticking = false;
    if (!narrow.matches || !scroller || chapters.length < 2) return;
    const step = chapters[1].offsetLeft - chapters[0].offsetLeft;
    if (step <= 0) return;
    const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
    const i = atEnd ? chapters.length - 1 : Math.round(scroller.scrollLeft / step);
    const next = Math.min(chapters.length - 1, Math.max(0, i));
    if (lock !== null) {
      if (next === lock) lock = null;
      return;
    }
    if (next !== story.chapter) setChapter(next);
  }
  if (scroller) {
    scroller.addEventListener(
      'scroll',
      () => {
        if (!ticking) requestAnimationFrame(fromScroll);
        ticking = true;
      },
      { passive: true },
    );
  }
  narrow.addEventListener('change', fromScroll);
  setChapter(0);
}

// ---------------------------------------------------------------------
//  Démo : APPUIE → SECOUE → BOIS
// ---------------------------------------------------------------------
function initDemo(scene, story) {
  const demo = document.querySelector('[data-demo]');
  if (!demo) return;
  const zone = demo.querySelector('[data-zone="demo"]');
  const fallbackImg = zone.querySelector('.stage__fallback');
  const live = demo.querySelector('[data-demo-live]');
  const gesture = demo.querySelector('[data-gesture]');
  const holdBtn = demo.querySelector('[data-action="press"]');
  const holdFill = demo.querySelector('[data-hold-fill]');
  const shakeBtn = demo.querySelector('[data-action="shake"]');
  const motionBtn = demo.querySelector('[data-action="motion"]');
  const drinkBtn = demo.querySelector('[data-action="drink"]');
  const meter = demo.querySelector('[data-meter]');
  const meterFill = demo.querySelector('[data-meter-fill]');
  const panels = Object.fromEntries([...demo.querySelectorAll('[data-panel]')].map((p) => [p.dataset.panel, p]));
  const dots = [...demo.querySelectorAll('[data-step-dot]')];
  const has3d = () => document.documentElement.classList.contains('has-3d');
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, reducedMotion.matches ? 0 : ms));

  let press = 0; // 0 → 1 pendant l'appui
  let holding = false;
  let holdRaf = 0;
  let energy = 0; // 0 → 1 pendant la secousse
  let shakeSign = 1;

  function setPhase(phase, { focus = false } = {}) {
    story.phase = phase;
    demo.dataset.phase = phase;
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== phase;
    const index = PHASES.indexOf(phase);
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-done', i < index);
      if (i === index) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    // Le lecteur d'écran annonce la nouvelle étape
    live.textContent = panels[phase].querySelector('.panel__title').textContent;
    // La démo bloque la rotation à la souris pendant APPUIE/SECOUE (le geste sert à la démo)
    zone.dataset.drag = phase === 'shake' ? 'off' : 'on';
    const btn = panels[phase].querySelector('button');
    if (focus && btn) btn.focus();
    const g = panels[phase].querySelector('[data-gesture-text]');
    showGesture(g ? g.dataset.gestureText : '');
    if (phase === 'shake') startMotion();
    else stopMotion();
  }

  function showGesture(text) {
    if (!gesture) return;
    gesture.textContent = text;
    gesture.classList.toggle('is-visible', Boolean(text));
  }

  // Petite animation de l'image de repli quand la 3D n'est pas disponible
  function animateFallback(keyframes, duration) {
    if (has3d() || reducedMotion.matches || !fallbackImg.animate) return;
    fallbackImg.animate(keyframes, { duration, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  // ---------- 1. APPUIE (maintenir) ----------
  function holdLoop(prev) {
    holdRaf = requestAnimationFrame((now) => {
      const dt = Math.min(now - prev, 50);
      press = holding ? Math.min(1, press + dt / HOLD_MS) : Math.max(0, press - dt / 350);
      holdFill.style.transform = `scaleX(${press})`;
      scene.call('setPress', press);
      if (press >= 1) return completePress();
      if (holding || press > 0) holdLoop(now);
    });
  }

  function holdStart() {
    if (story.phase !== 'press' || holding) return;
    holding = true;
    demo.classList.add('is-holding');
    cancelAnimationFrame(holdRaf);
    holdLoop(performance.now());
  }

  function holdEnd() {
    holding = false;
    demo.classList.remove('is-holding');
  }

  function completePress() {
    holdEnd();
    cancelAnimationFrame(holdRaf);
    press = 1;
    holdFill.style.transform = 'scaleX(1)';
    if (reducedMotion.matches) scene.call('jumpTo', 'shake');
    else scene.call('release');
    animateFallback([{ transform: 'translateY(0)' }, { transform: 'translateY(6px) scaleY(.98)' }, { transform: 'translateY(0)' }], 400);
    later(() => setPhase('shake', { focus: document.activeElement === holdBtn }), 1100);
  }

  holdBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    holdBtn.setPointerCapture(e.pointerId);
    holdStart();
  });
  holdBtn.addEventListener('pointerup', holdEnd);
  holdBtn.addEventListener('pointercancel', holdEnd);
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  // Clavier (Entrée / Espace) : un appui suffit, pas besoin de maintenir.
  holdBtn.addEventListener('click', (e) => {
    if (e.detail === 0 && story.phase === 'press') completePress();
  });

  // Maintenir directement le bouchon dans la scène 3D (phase « capture » : avant la rotation)
  zone.addEventListener(
    'pointerdown',
    (e) => {
      if (story.phase !== 'press' || !scene.api || !scene.api.hitCap(e.clientX, e.clientY)) return;
      zone.dataset.drag = 'off';
      holdStart();
      const up = () => {
        holdEnd();
        if (story.phase === 'press') zone.dataset.drag = 'on';
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
      };
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    },
    { capture: true },
  );

  // ---------- 2. SECOUE ----------
  function addEnergy(amount, impulse) {
    if (story.phase !== 'shake' || energy >= 1) return;
    energy = Math.min(1, energy + amount);
    scene.call('shake', impulse);
    scene.call('setDissolve', energy);
    meterFill.style.transform = `scaleX(${energy})`;
    meter.setAttribute('aria-valuenow', String(Math.round(energy * 100)));
    if (energy >= 1) later(() => setPhase('drink', { focus: document.activeElement === shakeBtn }), 700);
  }

  shakeBtn.addEventListener('click', () => {
    shakeSign = -shakeSign;
    addEnergy(0.2, shakeSign * 7);
    animateFallback(
      [{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(7deg)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(0)' }],
      450,
    );
  });

  // Glisser vite de gauche à droite sur la bouteille : chaque changement de sens compte.
  let lastX = null;
  let lastDir = 0;
  let lastT = 0;
  zone.addEventListener('pointerdown', (e) => {
    if (story.phase === 'shake') {
      lastX = e.clientX;
      lastT = e.timeStamp;
    }
  });
  zone.addEventListener('pointermove', (e) => {
    if (story.phase !== 'shake' || lastX === null) return;
    const dx = e.clientX - lastX;
    const dt = Math.max(e.timeStamp - lastT, 1);
    if (Math.abs(dx) < 6) return;
    const dir = Math.sign(dx);
    const speed = Math.abs(dx) / dt; // px par ms
    if (dir !== lastDir && speed > 0.25) {
      addEnergy(0.09, dir * Math.min(9, 3 + speed * 4));
      animateFallback([{ transform: 'rotate(0)' }, { transform: `rotate(${dir * 6}deg)` }, { transform: 'rotate(0)' }], 220);
    }
    lastDir = dir;
    lastX = e.clientX;
    lastT = e.timeStamp;
  });
  const stopSwipe = () => {
    lastX = null;
  };
  zone.addEventListener('pointerup', stopSwipe);
  zone.addEventListener('pointercancel', stopSwipe);

  // Capteur de mouvement : automatique si aucune autorisation n'est demandée ;
  // sur iPhone (autorisation obligatoire), seulement après un tap sur le bouton dédié.
  let motionOn = false;
  let lastMotion = 0;
  const needsPermission = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  const isTouch = matchMedia('(pointer: coarse)').matches; // pas de capteur utile sur ordinateur
  function onMotion(e) {
    const a = e.acceleration && e.acceleration.x !== null ? e.acceleration : null;
    if (!a) return;
    const force = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    if (force > 14 && e.timeStamp - lastMotion > 140) {
      lastMotion = e.timeStamp;
      addEnergy(0.08, Math.sign(a.x || 1) * 6);
    }
  }
  function startMotion() {
    if (typeof DeviceMotionEvent === 'undefined' || !isTouch) return;
    if (needsPermission && !motionOn) {
      motionBtn.hidden = false;
      return;
    }
    addEventListener('devicemotion', onMotion);
  }
  function stopMotion() {
    removeEventListener('devicemotion', onMotion);
    motionBtn.hidden = true;
  }
  motionBtn.addEventListener('click', async () => {
    try {
      if ((await DeviceMotionEvent.requestPermission()) === 'granted') {
        motionOn = true;
        motionBtn.hidden = true;
        addEventListener('devicemotion', onMotion);
      }
    } catch {
      motionBtn.hidden = true;
    }
  });

  // ---------- 3. BOIS ----------
  drinkBtn.addEventListener('click', () => {
    if (story.phase !== 'drink') return;
    // À lire AVANT disabled : un bouton désactivé perd le focus (il passe sur <body>).
    const hadFocus = document.activeElement === drinkBtn;
    drinkBtn.disabled = true;
    if (reducedMotion.matches) scene.call('jumpTo', 'done');
    else scene.call('drink');
    animateFallback([{ transform: 'rotate(0)' }, { transform: 'rotate(-35deg) translateY(-20px)' }, { transform: 'rotate(0)' }], 1400);
    later(() => {
      drinkBtn.disabled = false;
      setPhase('done', { focus: hadFocus });
    }, 1700);
  });

  // ---------- Recommencer ----------
  demo.querySelector('[data-action="reset"]').addEventListener('click', () => {
    timers.splice(0).forEach(clearTimeout);
    holdEnd();
    cancelAnimationFrame(holdRaf);
    press = 0;
    energy = 0;
    holdFill.style.transform = 'scaleX(0)';
    meterFill.style.transform = 'scaleX(0)';
    meter.setAttribute('aria-valuenow', '0');
    drinkBtn.disabled = false;
    scene.call('reset');
    setPhase('press', { focus: true });
  });

  setPhase('press');
}
