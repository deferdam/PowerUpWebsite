// =====================================================================
//  SCÈNE 3D (Three.js) — chargée à la demande, jamais au premier affichage.
//
//  Un seul canvas WebGL pour tout le site (important sur mobile). Il est fixe,
//  derrière le contenu. À chaque image, on cherche la « zone » ([data-zone])
//  la plus visible et on place la bouteille dessus : hero, chapitres, démo.
//
//  La bouteille est 100 % procédurale (pas de fichier 3D à charger) :
//  - corps PET givré (LatheGeometry = profil qu'on fait tourner autour d'un axe)
//  - boisson intérieure, qui « vague » quand on secoue (petit shader)
//  - étiquette dessinée dans un <canvas> avec les polices du site
//  - bouchon haut : bague moletée, chambre sèche transparente avec la poudre,
//    membrane, bouton-poussoir vert
//  - poudre qui tombe = THREE.Points
// =====================================================================

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  Mesh,
  Points,
  LatheGeometry,
  CylinderGeometry,
  CircleGeometry,
  PlaneGeometry,
  BufferGeometry,
  BufferAttribute,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshBasicMaterial,
  PointsMaterial,
  CanvasTexture,
  PMREMGenerator,
  DirectionalLight,
  Raycaster,
  SplineCurve,
  Vector2,
  Color,
  SRGBColorSpace,
  NeutralToneMapping,
  RepeatWrapping,
  DoubleSide,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// ---------- Dimensions de la bouteille (unités 3D, le bas est à y = 0) ----------
const BOTTLE_H = 2.76; // hauteur totale, bouton compris
const CENTER_Y = 1.38; // milieu : point de rotation
const FILL_Y = 1.52; // niveau de la boisson
const FILL_END = 0.06; // ce qui reste après « Bois »
const CHAMBER = { bottom: 2.25, top: 2.6, radius: 0.19 }; // chambre sèche du bouchon
const CAM_Z = 12;
const FOV = 26;

// ---------- Cadrage par zone et par chapitre ----------
// fill : part de la hauteur de la zone occupée par la bouteille ; zoom : grossissement ;
// focus : hauteur (sur la bouteille) placée au centre de la zone ; yaw/tilt : angles visés.
const ZONES = {
  hero: { fill: 0.88, zoom: 1, focus: CENTER_Y, yaw: null, tilt: 0.06 },
  demo: { fill: 0.82, zoom: 1, focus: CENTER_Y, yaw: -0.45, tilt: 0.05 },
  chapters: { fill: 0.8 },
};
const CHAPTERS = [
  { yaw: 0.6, tilt: 0.22, zoom: 2.1, focus: 2.3 }, // 01 le bouchon
  { yaw: -0.85, tilt: 0.1, zoom: 1.6, focus: 2.05 }, // 02 la dose
  { yaw: 0, tilt: 0.02, zoom: 1.0, focus: CENTER_Y }, // 03 la boisson (étiquette de face)
  { yaw: Math.PI, tilt: -0.04, zoom: 1.12, focus: 1.25 }, // 04 pour qui (dos de l'étiquette)
];

const COLORS = {
  chalk: '#EEEBE3',
  muted: '#8A8A85',
  graphite: '#141416',
  volt: '#D4FF3A',
  liquid: new Color('#E3EE9A'),
  cloudy: new Color('#F2F1E6'),
};

// ---------- Petites aides ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, v) => smooth(clamp((v - a) / (b - a), 0, 1));
const damp = (k, dt) => 1 - Math.exp(-k * dt); // lissage indépendant du nombre d'images/s
/** Ramène un angle dans ]-π, π] (pour tourner par le chemin le plus court). */
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Ombre douce sous la bouteille (dégradé radial). */
function shadowTexture() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.7)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Motif moleté (comme une barre de musculation) pour la bague du bouchon. */
function knurlTexture() {
  const c = makeCanvas(64, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 64, 64);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#d0d0d0';
  for (let i = -64; i <= 128; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 64, 64);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + 64, 0);
    ctx.lineTo(i, 64);
    ctx.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(26, 3);
  return t;
}

/** Petit point rond et doux pour chaque grain de poudre. */
function dotTexture() {
  const c = makeCanvas(32, 32);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

/** Écrit un texte en le rétrécissant s'il dépasse maxWidth. */
function fitText(ctx, text, x, y, maxWidth) {
  const w = ctx.measureText(text).width;
  if (w > maxWidth) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(maxWidth / w, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else ctx.fillText(text, x, y);
}

/**
 * Étiquette tout autour de la bouteille. Le centre du canvas est face à la caméra
 * (marque + dose), les bords gauche/droit se rejoignent au dos (les sports).
 */
function drawLabel(canvas, label) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const display = (size) => `900 ${Math.round(size)}px "Archivo", "Arial Narrow", Arial, sans-serif`;
  const mono = (size, weight = 700) => `${weight} ${Math.round(size)}px "JetBrains Mono", ui-monospace, monospace`;
  if ('fontStretch' in ctx) ctx.fontStretch = 'condensed';

  ctx.fillStyle = COLORS.graphite;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = COLORS.volt;
  ctx.fillRect(0, 0, W, H * 0.04);
  ctx.fillStyle = 'rgba(238,235,227,0.16)';
  ctx.fillRect(0, H * 0.955, W, H * 0.045);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Face avant : la marque en très grand, la dose en dessous
  ctx.fillStyle = COLORS.chalk;
  ctx.font = display(H * 0.5);
  fitText(ctx, label.brand.toUpperCase(), W / 2, H * 0.42, W * 0.3);
  ctx.fillStyle = COLORS.volt;
  ctx.font = mono(H * 0.085);
  fitText(ctx, (label.labelDose || '').toUpperCase(), W / 2, H * 0.78, W * 0.3);

  // Côtés : petites mentions techniques
  ctx.fillStyle = COLORS.muted;
  ctx.font = mono(H * 0.06, 400);
  for (const x of [W * 0.24, W * 0.76]) fitText(ctx, (label.labelMeta || '').toUpperCase(), x, H * 0.5, W * 0.12);

  // Dos : les sports, à cheval sur la couture (dessiné aux deux bords)
  ctx.fillStyle = COLORS.chalk;
  ctx.font = display(H * 0.2);
  for (const x of [0, W]) fitText(ctx, (label.labelSports || '').toUpperCase(), x, H * 0.5, W * 0.34);
}

// =====================================================================

/**
 * Crée la scène. Lève une erreur si WebGL n'est pas disponible
 * (l'appelant garde alors l'image de repli).
 */
export async function createStage({ canvas, zones, reducedMotion = false, label }) {
  const mobile = matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_Z);

  // Reflets réalistes sans fichier HDR : une « pièce » générée par Three.js
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTexture = pmrem.fromScene(room, 0.04).texture;
  if (room.dispose) room.dispose();
  scene.environment = envTexture;

  const key = new DirectionalLight('#ffffff', 1.4);
  key.position.set(3, 5, 6);
  const rim = new DirectionalLight(COLORS.volt, 2.2); // liseré vert sur le bord
  rim.position.set(-5, 2, -3);
  scene.add(key, rim);

  // ---------- Hiérarchie : anchor (position/échelle) > pivot (rotation) > bottle ----------
  const anchor = new Group();
  const pivot = new Group();
  pivot.rotation.order = 'ZXY'; // tourne sur elle-même, puis s'incline vers l'écran
  pivot.position.y = CENTER_Y;
  const bottle = new Group();
  bottle.position.y = -CENTER_Y;
  pivot.add(bottle);
  anchor.add(pivot);
  scene.add(anchor);

  const seg = mobile ? 40 : 72;
  const disposables = [];
  const keep = (...things) => (disposables.push(...things), things[0]);

  // Profil du corps (rayon, hauteur), lissé par une courbe
  const profile = new SplineCurve(
    [
      [0, 0], [0.36, 0], [0.46, 0.03], [0.5, 0.12], [0.5, 0.42], [0.468, 0.6], [0.468, 0.78], [0.5, 0.96],
      [0.5, 1.46], [0.47, 1.62], [0.38, 1.78], [0.27, 1.9], [0.245, 1.98], [0.245, 2.06],
    ].map(([x, y]) => new Vector2(x, y)),
  ).getPoints(mobile ? 48 : 90);

  // Corps PET givré (transparent, pas de « transmission » : trop coûteux sur mobile)
  const glassMat = keep(
    new MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.24,
      metalness: 0,
      transparent: true,
      opacity: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.3,
      depthWrite: false,
    }),
  );
  const body = new Mesh(keep(new LatheGeometry(profile, seg)), glassMat);
  body.renderOrder = 3;
  bottle.add(body);

  // Boisson : même profil, un peu plus fin, coupé au niveau de remplissage
  const liquidProfile = profile
    .filter((p) => p.y <= FILL_Y)
    .map((p) => new Vector2(Math.max(0, p.x * 0.95 - 0.004), Math.max(p.y, 0.02)));
  liquidProfile.push(new Vector2(0, FILL_Y));
  const liquidMat = keep(
    new MeshPhysicalMaterial({
      color: COLORS.liquid.clone(),
      roughness: 0.1,
      transparent: true,
      opacity: 0.8,
      clearcoat: 0.6,
      emissive: '#3a4400',
      emissiveIntensity: 0.35,
      depthWrite: false,
    }),
  );
  // Vague de surface : on déforme le haut du liquide selon uWobble (shader de Three.js modifié)
  const wobble = { value: new Vector2() };
  liquidMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWobble = wobble;
    shader.vertexShader = 'uniform vec2 uWobble;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float topW = smoothstep(${(FILL_Y - 0.45).toFixed(2)}, ${FILL_Y.toFixed(2)}, position.y);
      transformed.y += (position.x * uWobble.x + position.z * uWobble.y) * topW;`,
    );
  };
  const liquid = new Mesh(keep(new LatheGeometry(liquidProfile, seg)), liquidMat);
  liquid.renderOrder = 1;
  bottle.add(liquid);

  // Étiquette (centre du canvas = face avant, grâce à thetaStart = -π)
  const labelCanvas = makeCanvas(mobile ? 1024 : 2048, mobile ? 152 : 304);
  drawLabel(labelCanvas, label);
  const labelTex = keep(new CanvasTexture(labelCanvas));
  labelTex.colorSpace = SRGBColorSpace;
  labelTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const labelMesh = new Mesh(
    keep(new CylinderGeometry(0.508, 0.508, 0.46, seg, 1, true, -Math.PI, Math.PI * 2)),
    keep(new MeshStandardMaterial({ map: labelTex, roughness: 0.55, metalness: 0.05 })),
  );
  labelMesh.position.y = 1.21;
  bottle.add(labelMesh);
  // On redessine quand les polices du site sont prêtes (sinon police système en attendant)
  if (document.fonts && document.fonts.ready) {
    Promise.all([
      document.fonts.load('900 64px "Archivo"'),
      document.fonts.load('700 32px "JetBrains Mono"'),
    ])
      .catch(() => {})
      .then(() => document.fonts.ready)
      .then(() => {
        drawLabel(labelCanvas, label);
        labelTex.needsUpdate = true;
      });
  }

  // ---------- Bouchon ----------
  const cap = new Group();
  bottle.add(cap);
  const knurl = keep(knurlTexture());
  const steelMat = keep(new MeshStandardMaterial({ color: '#1d1d20', metalness: 0.75, roughness: 0.36, bumpMap: knurl, bumpScale: 1.5 }));
  const darkMat = keep(new MeshStandardMaterial({ color: '#19191b', metalness: 0.6, roughness: 0.4 }));
  const collar = new Mesh(keep(new CylinderGeometry(0.29, 0.29, 0.24, seg)), steelMat);
  collar.position.y = 2.13;
  const rimTop = new Mesh(keep(new CylinderGeometry(0.272, 0.272, 0.05, seg)), darkMat);
  rimTop.position.y = 2.625;
  const chamberMat = keep(
    new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.06, transparent: true, opacity: 0.2, clearcoat: 1, depthWrite: false }),
  );
  const chamber = new Mesh(keep(new CylinderGeometry(0.255, 0.255, CHAMBER.top - CHAMBER.bottom, seg, 1, true)), chamberMat);
  chamber.position.y = (CHAMBER.top + CHAMBER.bottom) / 2;
  chamber.renderOrder = 4;
  // Poudre de créatine dans la chambre (base à y = 0 pour pouvoir la « vider » en scale.y)
  const powderGeo = keep(new CylinderGeometry(0.2, 0.2, 0.26, 32));
  powderGeo.translate(0, 0.13, 0);
  const powder = new Mesh(powderGeo, keep(new MeshStandardMaterial({ color: '#F4F2EA', roughness: 1 })));
  powder.position.y = CHAMBER.bottom + 0.008;
  // Membrane qui s'ouvre (elle rétrécit comme un diaphragme)
  const membraneGeo = keep(new CircleGeometry(0.24, 32));
  membraneGeo.rotateX(-Math.PI / 2);
  const membrane = new Mesh(membraneGeo, keep(new MeshStandardMaterial({ color: '#BDBAB2', roughness: 0.6, metalness: 0.2, side: DoubleSide })));
  membrane.position.y = CHAMBER.bottom;
  // Bouton-poussoir + tige
  const plunger = new Group();
  const buttonMat = keep(new MeshStandardMaterial({ color: COLORS.volt, roughness: 0.35, emissive: COLORS.volt, emissiveIntensity: 0.18 }));
  const button = new Mesh(keep(new CylinderGeometry(0.18, 0.19, 0.09, seg)), buttonMat);
  button.position.y = 2.695;
  const rod = new Mesh(keep(new CylinderGeometry(0.028, 0.028, 0.3, 12)), darkMat);
  rod.position.y = 2.5;
  plunger.add(button, rod);
  cap.add(collar, rimTop, chamber, powder, membrane, plunger);
  // Zone de clic plus large que le bouchon (invisible) : pratique au doigt
  const capHit = new Mesh(keep(new CylinderGeometry(0.42, 0.42, 0.8, 12)), keep(new MeshBasicMaterial({ visible: false })));
  capHit.position.y = 2.38;
  cap.add(capHit);

  // Ombre de contact (reste à plat : elle est dans anchor, pas dans pivot)
  const shadowMat = keep(new MeshBasicMaterial({ map: keep(shadowTexture()), transparent: true, depthWrite: false, opacity: 1 }));
  const shadowGeo = keep(new PlaneGeometry(1.9, 1.9));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new Mesh(shadowGeo, shadowMat);
  shadow.position.y = 0.002;
  anchor.add(shadow);

  // ---------- Poudre qui tombe (particules) ----------
  const N = mobile ? 320 : 700;
  const pPos = new Float32Array(N * 3);
  const pVel = new Float32Array(N * 3);
  const pDelay = new Float32Array(N);
  const pGeo = keep(new BufferGeometry());
  pGeo.setAttribute('position', new BufferAttribute(pPos, 3));
  const pMat = keep(
    new PointsMaterial({ color: '#FAF8F0', size: 0.04, map: keep(dotTexture()), transparent: true, depthWrite: false, opacity: 1 }),
  );
  const particles = new Points(pGeo, pMat);
  particles.frustumCulled = false;
  particles.visible = false;
  particles.renderOrder = 2;
  bottle.add(particles);

  function seedParticles(inLiquid) {
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt(Math.random()) * (inLiquid ? 0.4 : CHAMBER.radius);
      const a = Math.random() * Math.PI * 2;
      pPos[i * 3] = Math.cos(a) * r;
      pPos[i * 3 + 1] = inLiquid ? 0.08 + Math.random() * 0.45 : CHAMBER.bottom + 0.02 + Math.random() * 0.22;
      pPos[i * 3 + 2] = Math.sin(a) * r;
      pVel[i * 3] = pVel[i * 3 + 1] = pVel[i * 3 + 2] = 0;
      pDelay[i] = inLiquid ? 0 : Math.random() * 0.55;
    }
    pGeo.attributes.position.needsUpdate = true;
  }

  // =================================================================
  //  État (tout ce qui bouge)
  // =================================================================
  const s = {
    yaw: 0.5,
    yawVel: 0,
    tilt: 0.06,
    lastUser: -1e9, // dernier geste de l'utilisateur (ms)
    chapter: 0,
    zoneName: 'hero',
    zoneVis: new Set(), // zones visibles à l'écran
    pos: null, // {x, y, sc} position actuelle lissée
    zoom: 1,
    focus: CENTER_Y,
    demoW: 0, // 1 quand la zone démo est active (sinon la bouteille revient « neuve »)
    // démo
    press: 0,
    released: false,
    releaseT: 0,
    dissolve: 0,
    dissolveShown: 0,
    shakeAng: 0,
    shakeVel: 0,
    drinkT: -1, // -1 = pas en train de boire ; 0 → 1 pendant ; 1 = fini
  };

  // =================================================================
  //  Interaction : glisser pour tourner (avec inertie) et flèches du clavier
  // =================================================================
  let drag = null;
  const now = () => performance.now();

  function onPointerDown(e) {
    const zone = e.currentTarget;
    if (zone.dataset.drag === 'off' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, mouse: e.pointerType === 'mouse' };
    s.yawVel = 0;
    s.lastUser = now();
    zone.classList.add('is-dragging');
    try {
      zone.setPointerCapture(e.pointerId); // on continue à suivre même hors de la zone
    } catch {
      /* ignoré */
    }
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const dt = Math.max((e.timeStamp - drag.t) / 1000, 1 / 240);
    s.yaw += dx * 0.01;
    s.yawVel = lerp(s.yawVel, (dx * 0.01) / dt, 0.5);
    // Inclinaison légère, souris seulement (au doigt, le geste vertical fait défiler la page)
    if (drag.mouse) s.tilt = clamp(s.tilt + dy * 0.004, -0.35, 0.35);
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = e.timeStamp;
    s.lastUser = now();
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    // Doigt (ou souris) immobile avant de lâcher : pas d'élan, la bouteille s'arrête.
    // drag.t = heure du dernier mouvement (aucun pointermove n'arrive quand on ne bouge plus).
    if (e.timeStamp - drag.t > 80) s.yawVel = 0;
    drag = null;
    s.yawVel = clamp(s.yawVel, -9, 9);
    s.lastUser = now();
    e.currentTarget.classList.remove('is-dragging');
  }
  function onKey(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      s.yawVel += e.key === 'ArrowLeft' ? -2.6 : 2.6;
      s.lastUser = now();
    }
  }
  for (const zone of zones) {
    zone.addEventListener('pointerdown', onPointerDown);
    zone.addEventListener('pointermove', onPointerMove);
    zone.addEventListener('pointerup', onPointerUp);
    zone.addEventListener('pointercancel', onPointerUp);
    zone.addEventListener('lostpointercapture', onPointerUp);
    zone.addEventListener('keydown', onKey);
  }

  // =================================================================
  //  Boucle d'animation : tourne seulement si une zone est visible
  // =================================================================
  let raf = 0;
  let last = 0;
  let size = { w: 0, h: 0 };
  let running = false;

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) s.zoneVis.add(e.target);
      else s.zoneVis.delete(e.target);
    }
    updateRunning();
  });
  zones.forEach((z) => io.observe(z));

  function onVisibility() {
    updateRunning();
  }
  document.addEventListener('visibilitychange', onVisibility);

  function updateRunning() {
    const shouldRun = s.zoneVis.size > 0 && !document.hidden;
    canvas.classList.toggle('is-off', s.zoneVis.size === 0);
    if (shouldRun && !running) {
      running = true;
      last = now();
      raf = requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === size.w && h === size.h) return;
    size = { w, h };
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /** La zone la plus visible à l'écran. */
  function pickZone() {
    let best = null;
    let bestVis = 0;
    for (const el of s.zoneVis) {
      const r = el.getBoundingClientRect();
      const vis = Math.min(r.bottom, size.h) - Math.max(r.top, 0);
      if (vis > bestVis) {
        bestVis = vis;
        best = { el, r };
      }
    }
    return best;
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((t - last) / 1000, 1 / 20);
    last = t;
    resize();
    const zone = pickZone();
    if (!zone) return;
    update(dt, t, zone);
    renderer.render(scene, camera);
  }

  function update(dt, t, zone) {
    const name = zone.el.dataset.zone;
    s.zoneName = name;
    const cfg = name === 'chapters' ? { ...ZONES.chapters, ...CHAPTERS[s.chapter] } : ZONES[name] || ZONES.hero;
    const userActive = drag || now() - s.lastUser < 1600;

    // ----- Rotation -----
    if (!drag) {
      s.yaw += s.yawVel * dt;
      s.yawVel *= Math.exp(-3 * dt); // inertie qui s'éteint
    }
    if (!userActive) {
      if (cfg.yaw !== null && cfg.yaw !== undefined) {
        s.yaw += wrapAngle(cfg.yaw - s.yaw) * damp(reducedMotion ? 10 : 3.2, dt);
      } else if (!reducedMotion) {
        s.yaw += 0.32 * dt; // rotation lente au repos
      }
    }
    if (!drag || !drag.mouse) s.tilt = lerp(s.tilt, cfg.tilt || 0, damp(3, dt));

    // ----- Placement sur la zone (en unités 3D) -----
    const upp = (2 * CAM_Z * Math.tan((FOV * Math.PI) / 360)) / size.h; // unités par pixel
    const r = zone.r;
    s.zoom = lerp(s.zoom, cfg.zoom || 1, damp(4, dt));
    s.focus = lerp(s.focus, cfg.focus || CENTER_Y, damp(4, dt));
    const px = Math.min((r.height * cfg.fill) / BOTTLE_H, (r.width * 0.8) / 1.0);
    const target = {
      sc: px * upp * s.zoom,
      x: (r.left + r.width / 2 - size.w / 2) * upp,
      y: -(r.top + r.height / 2 - size.h / 2) * upp,
    };
    if (!s.pos) s.pos = { ...target };
    const k = damp(reducedMotion ? 30 : 9, dt);
    s.pos.sc = lerp(s.pos.sc, target.sc, k);
    s.pos.x = lerp(s.pos.x, target.x, k);
    s.pos.y = lerp(s.pos.y, target.y, k);

    // ----- Démo -----
    s.demoW = lerp(s.demoW, name === 'demo' ? 1 : 0, damp(5, dt));
    const w = s.demoW;
    // ressort de la secousse
    s.shakeVel += (-70 * s.shakeAng - 7 * s.shakeVel) * dt;
    s.shakeAng += s.shakeVel * dt;
    if (s.released) s.releaseT += dt;
    s.dissolveShown = lerp(s.dissolveShown, s.dissolve, damp(3, dt));
    let drinkAngle = 0;
    let fill = 1;
    if (s.drinkT >= 0) {
      if (s.drinkT < 1) s.drinkT = Math.min(1, s.drinkT + dt / 1.6);
      const d = s.drinkT;
      drinkAngle = d >= 1 ? 0 : 1.15 * (d < 0.3 ? smooth(d / 0.3) : d < 0.7 ? 1 : 1 - smooth((d - 0.7) / 0.3));
      fill = lerp(1, FILL_END, smoothstep(0.25, 0.75, d));
    }

    anchor.position.set(s.pos.x + s.shakeAng * 0.35 * s.pos.sc * w, s.pos.y - s.focus * s.pos.sc, 0);
    anchor.scale.setScalar(s.pos.sc);
    pivot.rotation.set(s.tilt, s.yaw, (s.shakeAng + drinkAngle) * w);

    // Bouton et membrane
    const shownPress = s.press * w;
    plunger.position.y = -0.075 * shownPress;
    const pulse = name === 'chapters' && s.chapter === 1 && !reducedMotion ? 0.5 + 0.5 * Math.sin(t / 260) : 0;
    buttonMat.emissiveIntensity = 0.18 + 0.5 * shownPress + 0.35 * pulse;
    const open = s.released ? Math.min(1, s.releaseT * 3) : s.press * 0.12;
    membrane.scale.setScalar(Math.max(0.001, 1 - open * w));
    const powderLeft = s.released ? Math.max(0, 1 - s.releaseT * 1.6) : 1;
    powder.scale.y = Math.max(0.001, 1 - (1 - powderLeft) * w);

    // Boisson : niveau, trouble pendant le mélange, vague
    const shownFill = lerp(1, fill, w);
    liquid.scale.y = shownFill;
    const cloud = s.released ? Math.min(1, s.releaseT * 1.5) * (1 - s.dissolveShown) * 0.7 * w : 0;
    liquidMat.color.copy(COLORS.liquid).lerp(COLORS.cloudy, cloud);
    wobble.value.set(-s.shakeAng * 1.5 * w + Math.sin(t / 140) * Math.abs(s.shakeVel) * 0.01, -s.yawVel * 0.025);
    shadowMat.opacity = 1 - Math.min(0.6, Math.abs(drinkAngle * w));

    // Particules : visibles seulement dans la démo, après l'appui
    particles.visible = s.released && w > 0.5 && s.dissolveShown < 0.98;
    if (particles.visible) {
      stepParticles(dt, shownFill);
      pMat.opacity = clamp(1 - s.dissolveShown * 1.05, 0, 1);
      pMat.size = 0.05 * s.pos.sc * (1 - 0.6 * s.dissolveShown);
    }
  }

  function stepParticles(dt, shownFill) {
    const surface = FILL_Y * shownFill;
    const swirl = s.shakeVel * 0.6;
    for (let i = 0; i < N; i++) {
      if (s.releaseT < pDelay[i]) continue;
      const ix = i * 3;
      let x = pPos[ix];
      let y = pPos[ix + 1];
      let z = pPos[ix + 2];
      if (y > surface) {
        pVel[ix + 1] -= 5.5 * dt; // chute libre
      } else {
        // dans la boisson : freinage, descente lente, tourbillon pendant la secousse
        pVel[ix + 1] += (-0.1 - pVel[ix + 1]) * Math.min(1, 5 * dt);
        pVel[ix] *= Math.exp(-2 * dt);
        pVel[ix + 2] *= Math.exp(-2 * dt);
        pVel[ix] += (-z * swirl + (Math.random() - 0.5) * 0.6) * dt;
        pVel[ix + 2] += (x * swirl + (Math.random() - 0.5) * 0.6) * dt;
        if (Math.abs(s.shakeVel) > 1) pVel[ix + 1] += (Math.random() - 0.3) * Math.abs(s.shakeVel) * 0.15 * dt;
      }
      x += pVel[ix] * dt;
      y += pVel[ix + 1] * dt;
      z += pVel[ix + 2] * dt;
      if (y < 0.06) {
        y = 0.06;
        pVel[ix + 1] = 0;
      }
      const maxR = y > 1.75 ? 0.2 : 0.42;
      const rr = Math.hypot(x, z);
      if (rr > maxR) {
        x *= maxR / rr;
        z *= maxR / rr;
      }
      pPos[ix] = x;
      pPos[ix + 1] = y;
      pPos[ix + 2] = z;
    }
    pGeo.attributes.position.needsUpdate = true;
  }

  // =================================================================
  //  API utilisée par story.js
  // =================================================================
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  function reset() {
    Object.assign(s, { press: 0, released: false, releaseT: 0, dissolve: 0, dissolveShown: 0, shakeAng: 0, shakeVel: 0, drinkT: -1 });
    particles.visible = false;
  }

  const api = {
    setChapter(i) {
      s.chapter = clamp(i | 0, 0, CHAPTERS.length - 1);
      s.lastUser = -1e9; // le chapitre reprend la main sur la rotation
    },
    setPress(p) {
      if (!s.released) s.press = clamp(p, 0, 1);
    },
    release() {
      if (s.released) return;
      seedParticles(false);
      s.press = 1;
      s.released = true;
      s.releaseT = 0;
    },
    shake(impulse) {
      s.shakeVel += impulse;
    },
    setDissolve(d) {
      s.dissolve = clamp(d, 0, 1);
    },
    drink() {
      if (s.drinkT < 0) s.drinkT = 0;
    },
    reset,
    /** Place directement la bouteille dans l'état de début d'une étape (mouvement réduit, rechargement). */
    jumpTo(phase) {
      reset();
      if (phase === 'press') return;
      seedParticles(true);
      Object.assign(s, { press: 1, released: true, releaseT: 5 });
      if (phase === 'drink' || phase === 'done') Object.assign(s, { dissolve: 1, dissolveShown: 1 });
      if (phase === 'done') s.drinkT = 1;
    },
    /** Le pointeur est-il sur le bouchon ? (pour « maintenir le bouchon » dans la démo) */
    hitCap(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(capHit, false).length > 0;
    },
    dispose() {
      cancelAnimationFrame(raf);
      running = false;
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const zone of zones) {
        zone.removeEventListener('pointerdown', onPointerDown);
        zone.removeEventListener('pointermove', onPointerMove);
        zone.removeEventListener('pointerup', onPointerUp);
        zone.removeEventListener('pointercancel', onPointerUp);
        zone.removeEventListener('lostpointercapture', onPointerUp);
        zone.removeEventListener('keydown', onKey);
      }
      disposables.forEach((d) => d.dispose && d.dispose());
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
      canvas.classList.add('is-off');
    },
  };

  resize();
  updateRunning();
  return api;
}
