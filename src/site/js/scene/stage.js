// =====================================================================
//  SCÈNE 3D (Three.js) — chargée à la demande, jamais au premier affichage.
//
//  Un seul canvas WebGL pour tout le site (important sur mobile). Il est fixe,
//  derrière le contenu. À chaque image, on cherche la « zone » ([data-zone])
//  la plus visible et on place la bouteille dessus : hero, chapitres, démo.
//
//  Tout est procédural (pas de fichier 3D à charger) :
//  - la DOSETTE-STYLO, le produit, d'après la coupe d'assemblage v0.3 : bouton vissé,
//    tige et piston, bagues de dose, corps transparent avec la poudre, membrane fendue,
//    embout à collerette qui se pose sur le goulot
//  - une bouteille quelconque (corps PET givré, LatheGeometry = profil qu'on fait tourner),
//    sa boisson qui « vague » quand on secoue (petit shader) et son étiquette (<canvas>)
//  - poudre qui tombe = THREE.Points
//  Intro (une fois) : la dosette seule en gros plan, puis elle tombe sur la bouteille.
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
  TorusGeometry,
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

// ---------- Dimensions (unités 3D, le bas de la bouteille est à y = 0) ----------
const NECK_TOP = 2.1; // haut du goulot
const NECK_R = 0.19; // rayon extérieur du goulot
const FILL_Y = 1.52; // niveau de la boisson
const FILL_END = 0.03; // ce qui reste après « Bois »

// Dosette-stylo, d'après la coupe d'assemblage v0.3 : cotes en mm le long de son axe
// (0 = collerette du corps, 63 = posée sur le goulot). Debout sur la bouteille, embout en bas.
const MM = 0.0145; // 1 mm → unités 3D
const at = (xmm) => (63 - xmm) * MM; // hauteur d'une cote au-dessus du goulot
const R = (mm) => mm * MM;
const PUSH_MM = 25.8; // course du bouton (−38 → −12 mm) : le piston va jusqu'à la membrane
const POWDER_MM = 24.5; // hauteur de poudre, du piston (35 mm) à la membrane (59,5 mm)
const TOTAL_H = NECK_TOP + at(-39.6); // bouteille + dosette, bouton tiré (≈ 3,6)
const CENTER_Y = TOTAL_H / 2; // milieu : point de rotation
const DOSE_MID = NECK_TOP + at(12); // milieu de la dosette posée
// Intro (une fois, dans le hero) : gros plan sur la dosette seule (hold), on recule et la
// bouteille apparaît dessous (reveal), puis la dosette tombe sur le goulot (fall) et se cale.
const INTRO = { lead: 0.5, hold: 1.0, reveal: 1.0, fall: 0.45, settle: 0.6, drop: 0.65, zoom: 2.05 };
const CAM_Z = 12;
const FOV = 26;

// ---------- Cadrage par zone et par chapitre ----------
// fill : part de la hauteur de la zone occupée par l'objet ; zoom : grossissement ;
// focus : hauteur (sur l'objet) placée au centre de la zone ; yaw/tilt : angles visés.
const ZONES = {
  hero: { fill: 0.86, zoom: 1, focus: CENTER_Y - 0.08, yaw: null, tilt: 0.06 },
  demo: { fill: 0.84, zoom: 1, focus: CENTER_Y, yaw: -0.45, tilt: 0.05 },
  chapters: { fill: 0.82 },
};
const CHAPTERS = [
  { yaw: 0.6, tilt: 0.16, zoom: 1.55, focus: DOSE_MID - 0.2 }, // 01 la dosette, en entier
  { yaw: -0.85, tilt: 0.08, zoom: 2.0, focus: NECK_TOP + at(30) }, // 02 la dose : chambre, bagues, membrane
  { yaw: 0, tilt: 0.02, zoom: 1.0, focus: CENTER_Y }, // 03 la boisson (étiquette de face)
  { yaw: Math.PI, tilt: -0.04, zoom: 1.1, focus: 1.75 }, // 04 pour qui (dos de l'étiquette), objet entier
];
// Téléphone / tablette (< 1024 px, même seuil que le CSS) : objet un peu plus petit et
// remonté dans le hero (la consigne « glisse pour tourner » est dessous), gros plans
// plus doux. Dans « Explore », le rendu est découpé au cadre (le gros plan fait loupe).
const ZONES_M = {
  hero: { fill: 0.84, zoom: 1, focus: CENTER_Y - 0.1, yaw: null, tilt: 0.06 },
  demo: { fill: 0.86, zoom: 1, focus: CENTER_Y, yaw: -0.45, tilt: 0.05 },
  chapters: { fill: 0.84 },
};
const CHAPTERS_M = [
  { ...CHAPTERS[0], zoom: 1.5 },
  { ...CHAPTERS[1], zoom: 1.85 },
  { ...CHAPTERS[2], zoom: 1.0 },
  { ...CHAPTERS[3], zoom: 1.05 },
];
const NARROW_MQ = '(max-width: 1023px)';

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
/**
 * Ressort à amortissement critique (solution exacte, donc indépendante du nombre
 * d'images/s) : part sans à-coup, arrive sans rebond. st = { x, v }, w = raideur (1/s).
 */
function spring(st, target, w, dt) {
  const x = st.x - target;
  const e = Math.exp(-w * dt);
  const k = (st.v + w * x) * dt;
  st.x = target + (x + k) * e;
  st.v = (st.v - w * k) * e;
}
const sp = (x = 0) => ({ x, v: 0 });

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

/** Flanc du bouton vissé : moletage fin et nom de la marque, trois fois sur le tour. */
function drawKnob(canvas, label) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  if ('fontStretch' in ctx) ctx.fontStretch = 'condensed';
  ctx.fillStyle = '#1c1c1f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = 0; x < W; x += 6) ctx.fillRect(x, 0, 2, H);
  ctx.fillStyle = COLORS.volt;
  ctx.fillRect(0, 0, W, H * 0.07);
  ctx.fillStyle = COLORS.chalk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(H * 0.56)}px "Archivo", "Arial Narrow", Arial, sans-serif`;
  for (const x of [W / 6, W / 2, (5 * W) / 6]) fitText(ctx, label.brand.toUpperCase(), x, H * 0.56, W * 0.2);
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
  // 22 % du tour (~80°) : au-delà, les lettres du bord fuient sur le côté de la bouteille.
  fitText(ctx, label.brand.toUpperCase(), W / 2, H * 0.42, W * 0.22);
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
export async function createStage({ canvas, zones, reducedMotion = false, intro = true, label }) {
  const mobile = matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  // < 1024 px : cadrages « mobile », rendu découpé au cadre dans Explore, et canvas qui
  // défile avec la page (voir frame()). Relu à chaque changement (rotation d'une tablette).
  const narrowMq = matchMedia(NARROW_MQ);
  let narrow = narrowMq.matches;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.autoClear = false; // on efface nous-mêmes, avant le découpage au cadre
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
  // La dosette a son propre pivot, qui tourne exactement comme la bouteille : elle peut
  // ainsi tomber dessus (intro) puis en être retirée pour boire, sans basculer avec elle.
  const anchor = new Group();
  const pivot = new Group();
  pivot.rotation.order = 'ZXY'; // tourne sur elle-même, puis s'incline vers l'écran
  pivot.position.y = CENTER_Y;
  const bottle = new Group();
  bottle.position.y = -CENTER_Y;
  pivot.add(bottle);
  const dosePivot = new Group();
  dosePivot.rotation.order = 'ZXY';
  dosePivot.position.y = CENTER_Y;
  const doseBase = new Group();
  doseBase.position.y = -CENTER_Y;
  dosePivot.add(doseBase);
  anchor.add(pivot, dosePivot);
  scene.add(anchor);

  const seg = mobile ? 40 : 72;
  const disposables = [];
  const keep = (...things) => (disposables.push(...things), things[0]);

  // Profil du corps (rayon, hauteur), lissé par une courbe
  const profile = new SplineCurve(
    [
      [0, 0], [0.36, 0], [0.46, 0.03], [0.5, 0.12], [0.5, 0.42], [0.468, 0.6], [0.468, 0.78], [0.5, 0.96],
      [0.5, 1.46], [0.47, 1.62], [0.37, 1.78], [0.25, 1.9], [NECK_R, 1.99], [NECK_R, NECK_TOP],
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
    // transparent : l'étiquette apparaît en fondu avec la bouteille pendant l'intro
    keep(new MeshStandardMaterial({ map: labelTex, roughness: 0.55, metalness: 0.05, transparent: true })),
  );
  const labelMat = labelMesh.material;
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
        drawKnob(knobCanvas, label);
        knobTex.needsUpdate = true;
      });
  }

  // Bague du goulot (détail des bouteilles PET standard)
  const neckRingMat = keep(new MeshStandardMaterial({ color: '#d9dcd6', roughness: 0.35, transparent: true, opacity: 0.55 }));
  const neckRing = new Mesh(keep(new CylinderGeometry(NECK_R + 0.045, NECK_R + 0.045, 0.025, seg)), neckRingMat);
  neckRing.position.y = 1.97;
  bottle.add(neckRing);

  // ---------- Dosette-stylo (le produit) ----------
  // Origine du groupe = point où l'embout se pose sur le goulot. Cotes : voir at() et R().
  const dose = new Group();
  dose.position.y = NECK_TOP;
  doseBase.add(dose);
  const lathe = (pts) => keep(new LatheGeometry(pts.map(([r, x]) => new Vector2(R(r), at(x))), seg));
  const solid = (opts) => keep(new MeshStandardMaterial({ side: DoubleSide, ...opts }));

  // Embout de distribution : manchon autour du corps, collerette, jupe qui coiffe le goulot.
  // Fumé translucide : on devine la membrane qui s'ouvre à l'intérieur.
  const tipMat = keep(
    new MeshPhysicalMaterial({ color: '#2a2c30', metalness: 0.2, roughness: 0.3, clearcoat: 0.8, transparent: true, opacity: 0.62, depthWrite: false, side: DoubleSide }),
  );
  const tip = new Mesh(
    lathe([[10.15, 51], [11.6, 51], [11.6, 57.4], [15.2, 57.9], [15.2, 61], [14.8, 61.6], [14.8, 70], [13.5, 70], [13.5, 62], [10.15, 62], [10.15, 51]]),
    tipMat,
  );
  // Liseré vert sur la collerette : il « claque » quand la dosette se pose
  const clipMat = keep(new MeshStandardMaterial({ color: COLORS.volt, roughness: 0.35, emissive: COLORS.volt, emissiveIntensity: 0.25 }));
  const clipRing = new Mesh(keep(new TorusGeometry(R(15.2), R(0.55), 8, seg)), clipMat);
  clipRing.rotation.x = Math.PI / 2;
  clipRing.position.y = at(57.9);
  tip.renderOrder = 6;

  // Corps transparent : on voit la poudre, le piston et les bagues
  const tubeMat = keep(
    new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.07, transparent: true, opacity: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false }),
  );
  const tube = new Mesh(keep(new CylinderGeometry(R(10), R(10), R(57), seg, 1, true)), tubeMat);
  tube.position.y = at(31.5);
  tube.renderOrder = 5;
  // Collerette du corps (appui des doigts, comme une seringue)
  const plasticMat = solid({ color: '#dcd9cf', roughness: 0.5 });
  const flange = new Mesh(keep(new CylinderGeometry(R(13), R(13), R(3), seg)), plasticMat);
  flange.position.y = at(1.5);
  // Bagues de dose (fixes) : 2 × 2 mL et 1 × 1 mL ; on en retire pour une plus grosse dose
  const ringMat2 = solid({ color: '#bdb9ad', roughness: 0.55 });
  const ringMat1 = solid({ color: '#a8c93a', roughness: 0.5 });
  const rings = [
    [2.9, 12.4, ringMat2],
    [12.8, 22.4, ringMat2],
    [22.8, 27.8, ringMat1],
  ].map(([a, b, mat]) => {
    const m = new Mesh(keep(new CylinderGeometry(R(8.1), R(8.1), R(b - a), seg)), mat);
    m.position.y = at((a + b) / 2);
    return m;
  });

  // Ce qui descend quand on pousse : bouton vissé, tige, piston et son joint torique
  const plunger = new Group();
  const knobCanvas = makeCanvas(mobile ? 384 : 576, mobile ? 64 : 96);
  drawKnob(knobCanvas, label);
  const knobTex = keep(new CanvasTexture(knobCanvas));
  knobTex.colorSpace = SRGBColorSpace;
  const knobSideMat = keep(new MeshStandardMaterial({ map: knobTex, metalness: 0.45, roughness: 0.45 }));
  const buttonMat = keep(new MeshStandardMaterial({ color: COLORS.volt, roughness: 0.35, emissive: COLORS.volt, emissiveIntensity: 0.18 }));
  const darkMat = keep(new MeshStandardMaterial({ color: '#19191b', metalness: 0.6, roughness: 0.4 }));
  const knob = new Mesh(keep(new CylinderGeometry(R(11), R(11), R(12.1), seg)), [knobSideMat, buttonMat, darkMat]);
  knob.position.y = at(-32.05);
  const knobTop = new Mesh(keep(new CylinderGeometry(R(9.4), R(10.6), R(1.5), seg)), buttonMat);
  knobTop.position.y = at(-38.85);
  const rod = new Mesh(keep(new CylinderGeometry(R(3.6), R(3.6), R(54), 16)), plasticMat);
  rod.position.y = at(1);
  const head = new Mesh(keep(new CylinderGeometry(R(8.2), R(8.2), R(7), seg)), solid({ color: '#2a2b2f', roughness: 0.5 }));
  head.position.y = at(31.5);
  const oring = new Mesh(keep(new TorusGeometry(R(8.2), R(0.95), 8, seg)), solid({ color: '#0e0e10', roughness: 0.7 }));
  oring.rotation.x = Math.PI / 2;
  oring.position.y = at(30);
  plunger.add(knob, knobTop, rod, head, oring);

  // Poudre de créatine, entre le piston et la membrane (base sur la membrane : elle se
  // « vide » vers le bas en scale.y quand le piston descend)
  const powderGeo = keep(new CylinderGeometry(R(8.1), R(8.1), 1, 32));
  powderGeo.translate(0, 0.5, 0);
  const powder = new Mesh(powderGeo, keep(new MeshStandardMaterial({ color: '#F4F2EA', roughness: 1 })));
  powder.position.y = at(59.5);
  powder.scale.y = R(POWDER_MM);

  // Membrane fendue : 6 pétales qui se rabattent vers le bas sous la poussée
  const membraneMat = solid({ color: '#ece7da', roughness: 0.55, emissive: '#3a3a30', emissiveIntensity: 0.4 }); // claire : se lit à travers l'embout
  const petalGeo = keep(new CircleGeometry(R(8.4), 6, -Math.PI / 6, Math.PI / 3));
  petalGeo.rotateX(-Math.PI / 2);
  petalGeo.translate(-R(8.4), 0, 0); // charnière sur le bord : la pointe est au centre
  const membrane = new Group();
  membrane.position.y = at(59.75);
  const petals = [];
  for (let i = 0; i < 6; i++) {
    const holder = new Group();
    holder.rotation.y = (i * Math.PI) / 3;
    const hinge = new Group();
    hinge.position.x = R(8.4);
    hinge.add(new Mesh(petalGeo, membraneMat));
    holder.add(hinge);
    membrane.add(holder);
    petals.push(hinge);
  }

  dose.add(tip, clipRing, tube, flange, ...rings, plunger, powder, membrane);
  // Zone de clic plus large que la dosette (invisible) : pratique au doigt
  const capHit = new Mesh(keep(new CylinderGeometry(0.34, 0.34, at(-40) - at(72), 12)), keep(new MeshBasicMaterial({ visible: false })));
  capHit.position.y = (at(-40) + at(72)) / 2;
  dose.add(capHit);

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

  // Dans la boisson (état après l'appui), ou à la sortie de la membrane : un filet de
  // poudre qui s'écoule pendant que le piston descend.
  function seedParticles(inLiquid) {
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt(Math.random()) * (inLiquid ? 0.4 : R(6));
      const a = Math.random() * Math.PI * 2;
      pPos[i * 3] = Math.cos(a) * r;
      pPos[i * 3 + 1] = inLiquid ? 0.08 + Math.random() * 0.45 : NECK_TOP + at(59.5) - Math.random() * 0.03;
      pPos[i * 3 + 2] = Math.sin(a) * r;
      pVel[i * 3] = pVel[i * 3 + 2] = 0;
      pVel[i * 3 + 1] = inLiquid ? 0 : -0.6 - Math.random() * 0.6; // poussée par le piston
      pDelay[i] = inLiquid ? 0 : 0.08 + Math.random() * 0.62;
    }
    pGeo.attributes.position.needsUpdate = true;
  }

  // =================================================================
  //  État (tout ce qui bouge)
  // =================================================================
  const s = {
    yaw: 0.5,
    yawVel: 0,
    yawEaseV: 0, // vitesse du ressort qui ramène vers l'angle du chapitre
    tilt: sp(0.06),
    lastUser: -1e9, // dernier geste de l'utilisateur (ms)
    chapter: 0,
    zoneName: 'hero',
    zoneEl: null, // zone sur laquelle la bouteille est posée
    zoneVis: new Set(), // zones visibles à l'écran
    pos: null, // {x, y, sc} position affichée (null = se placer d'un coup)
    // La bouteille suit sa zone exactement pendant le défilement ; seul le passage
    // d'une zone à l'autre est animé, par un décalage qui revient à 0 en ressort.
    offX: sp(),
    offY: sp(),
    base: sp(), // échelle donnée par la zone (sans le zoom)
    zoom: sp(1),
    focus: sp(CENTER_Y),
    clip: sp(), // 0 = plein écran, 1 = rendu découpé au cadre de la zone « chapters »
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
    // Intro : temps écoulé (négatif = attente pendant le fondu d'apparition du canvas)
    introT: -INTRO.lead,
    introDone: reducedMotion || !intro,
    press0: 0, // appui atteint au moment du clic (pour que le piston reparte de là)
  };

  // =================================================================
  //  Interaction : glisser pour tourner (avec inertie) et flèches du clavier
  // =================================================================
  // Au doigt, un appui sur la zone ne devient une rotation qu'au premier mouvement
  // nettement horizontal : un défilement vertical qui commence sur la bouteille reste
  // un défilement (le navigateur l'annule par pointercancel) et ne fige rien.
  let drag = null; // rotation confirmée
  let pending = null; // appui au doigt pas encore confirmé
  const now = () => performance.now();
  const VEL_WINDOW = 80; // ms : l'élan est mesuré sur les derniers mouvements seulement

  function onPointerDown(e) {
    const zone = e.currentTarget;
    if (zone.dataset.drag === 'off' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = {
      id: e.pointerId,
      zone,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      mouse: e.pointerType === 'mouse',
      samples: [{ x: e.clientX, t: e.timeStamp }],
    };
    if (p.mouse) startDrag(p);
    else pending = p;
  }
  function startDrag(p) {
    pending = null;
    drag = p;
    s.yawVel = 0;
    s.yawEaseV = 0;
    s.lastUser = now();
    p.zone.classList.add('is-dragging');
    try {
      p.zone.setPointerCapture(p.id); // on continue à suivre même hors de la zone
    } catch {
      /* ignoré */
    }
  }
  /** Vitesse (px/s) sur les dernières VEL_WINDOW ms : un petit mouvement isolé ne lance pas la bouteille. */
  function dragVelocity(tNow) {
    const list = drag.samples;
    while (list.length > 2 && tNow - list[0].t > VEL_WINDOW) list.shift();
    const a = list[0];
    const b = list[list.length - 1];
    if (!a || a === b) return 0;
    return (b.x - a.x) / Math.max((b.t - a.t) / 1000, 1 / 60);
  }
  function onPointerMove(e) {
    if (pending && e.pointerId === pending.id) {
      if (pending.zone.dataset.drag === 'off') {
        pending = null;
        return;
      }
      const dx = e.clientX - pending.x0;
      const dy = e.clientY - pending.y0;
      if (Math.abs(dx) > 8 && Math.abs(dx) > 1.2 * Math.abs(dy)) startDrag(pending);
      else {
        if (Math.abs(dy) > 12) pending = null; // geste vertical : c'est un défilement
        return;
      }
    }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    s.yaw += dx * 0.01;
    // Inclinaison légère, souris seulement (au doigt, le geste vertical fait défiler la page)
    if (drag.mouse) {
      s.tilt.x = clamp(s.tilt.x + dy * 0.004, -0.35, 0.35);
      s.tilt.v = 0;
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = e.timeStamp;
    drag.samples.push({ x: e.clientX, t: e.timeStamp });
    s.yawVel = dragVelocity(e.timeStamp) * 0.01; // sert aussi à la vague de la boisson
    s.lastUser = now();
  }
  function onPointerUp(e) {
    if (pending && e.pointerId === pending.id) {
      pending = null; // simple tap, ou défilement repris par le navigateur : rien à faire
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    // Doigt (ou souris) immobile avant de lâcher : pas d'élan, la bouteille s'arrête.
    // drag.t = heure du dernier mouvement (aucun pointermove n'arrive quand on ne bouge plus).
    const v = e.timeStamp - drag.t > VEL_WINDOW ? 0 : dragVelocity(e.timeStamp) * 0.01;
    const max = drag.mouse ? 9 : 6;
    s.yawVel = clamp(v, -max, max);
    drag.zone.classList.remove('is-dragging');
    drag = null;
    s.lastUser = now();
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
      // Au retour, la bouteille se replace d'un coup (le canvas est masqué entre-temps) :
      // pas de vol depuis une position périmée.
      s.pos = null;
      s.zoneEl = null;
    }
  }

  let canvasY = null; // décalage vertical appliqué au canvas (< 1024 px)
  function onNarrowChange() {
    narrow = narrowMq.matches;
    s.pos = null;
    canvasY = null;
    if (!narrow) canvas.style.transform = '';
  }
  narrowMq.addEventListener('change', onNarrowChange);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === size.w && h === size.h) return;
    size = { w, h };
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /**
   * La zone la plus visible à l'écran. Avec hystérésis : on garde la zone actuelle tant
   * qu'elle est visible et qu'aucune autre ne la dépasse nettement (sinon, près d'une
   * frontière, la bouteille ferait des allers-retours entre deux zones).
   */
  function pickZone() {
    let best = null;
    let bestVis = 0;
    let cur = null;
    let curVis = 0;
    for (const el of s.zoneVis) {
      const r = el.getBoundingClientRect();
      const vis = Math.min(r.bottom, size.h) - Math.max(r.top, 0);
      if (vis <= 0) continue;
      if (el === s.zoneEl) {
        cur = { el, r };
        curVis = vis;
      }
      if (vis > bestVis) {
        bestVis = vis;
        best = { el, r };
      }
    }
    if (cur && best && best.el !== cur.el && bestVis < curVis + Math.max(48, size.h * 0.1)) return cur;
    return best;
  }

  const chaptersZone = zones.find((z) => z.dataset.zone === 'chapters') || null;

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = clamp((t - last) / 1000, 0, 1 / 20); // jamais négatif (1re image)
    last = t;
    resize();
    // < 1024 px, le canvas est dans le flux de la page (position absolue) : on le recale
    // sur l'écran dans la même image que le rendu. Pendant un défilement inertiel (géré
    // hors du fil JS sur iOS / Android), il bouge donc avec la page, et la bouteille
    // reste collée à sa zone au lieu de flotter d'une image.
    if (narrow) {
      const y = Math.round(window.scrollY);
      if (y !== canvasY) {
        canvasY = y;
        canvas.style.transform = `translate3d(0, ${y}px, 0)`;
      }
    }
    const zone = pickZone();
    if (!zone) return;
    update(dt, t, zone);
    renderer.setScissorTest(false);
    renderer.clear(); // tout le canvas, avant le découpage
    applyClip();
    renderer.render(scene, camera);
  }

  /** Mobile, chapitres : rendu découpé au cadre de la zone (le gros plan ne déborde pas sur le texte). */
  function applyClip() {
    const c = clamp(s.clip.x, 0, 1);
    if (c < 0.001 || !chaptersZone) return;
    const r = chaptersZone.getBoundingClientRect();
    const left = lerp(0, r.left + 1, c);
    const top = lerp(0, r.top + 1, c);
    const right = lerp(size.w, r.right - 1, c);
    const bottom = lerp(size.h, r.bottom - 1, c);
    // setScissor : px CSS, origine en bas à gauche (Three applique lui-même le pixelRatio)
    renderer.setScissor(left, size.h - bottom, Math.max(0, right - left), Math.max(0, bottom - top));
    renderer.setScissorTest(true);
  }

  function update(dt, t, zone) {
    const name = zone.el.dataset.zone;
    s.zoneName = name;
    const Z = narrow ? ZONES_M : ZONES;
    const C = narrow ? CHAPTERS_M : CHAPTERS;
    let cfg = name === 'chapters' ? { ...Z.chapters, ...C[s.chapter] } : Z[name] || Z.hero;

    // ----- Intro : la dosette seule en gros plan, puis elle tombe sur le goulot -----
    // Une seule fois, et seulement si la page s'ouvre sur le hero ; on la termine d'un
    // coup si on quitte le hero avant la fin.
    let dropY = 0; // hauteur de la dosette au-dessus du goulot
    let bottleVis = 1; // 0 = bouteille invisible, 1 = là
    let landing = 0; // petit choc à l'arrivée (0 → 1 → 0)
    let introCam = null; // cadrage imposé pendant l'intro (sinon : ressorts vers cfg)
    if (!s.introDone && name !== 'hero') s.introDone = true;
    if (!s.introDone) {
      const it = Math.max(0, s.introT);
      s.introT += dt;
      const D = INTRO.drop;
      const tReveal = INTRO.hold;
      const tFall = tReveal + INTRO.reveal;
      const tLand = tFall + INTRO.fall;
      const midZoom = TOTAL_H / (TOTAL_H + D); // assez de recul pour la dosette en l'air
      const midFocus = CENTER_Y + D / 2;
      const rv = clamp((it - tReveal) / INTRO.reveal, 0, 1);
      const fall = clamp((it - tFall) / INTRO.fall, 0, 1);
      const bob = 0.03 * Math.sin(it * 2.4) * (1 - smoothstep(tFall - 0.4, tFall, it));
      dropY = D * (1 - fall * fall) + bob; // chute accélérée, comme un objet lâché
      // La bouteille n'apparaît qu'une fois assez de recul pris (sinon elle déborde de la zone)
      bottleVis = smoothstep(0.7, 1, rv);
      if (it < tFall) {
        introCam = { zoom: lerp(INTRO.zoom, midZoom, smooth(rv)), focus: lerp(DOSE_MID + D, midFocus, smooth(rv)) };
      } else if (it < tLand) {
        const e = smooth(fall);
        introCam = { zoom: lerp(midZoom, cfg.zoom || 1, e), focus: lerp(midFocus, cfg.focus || CENTER_Y, e) };
      }
      if (introCam) {
        // Garde-fous : le haut de la dosette et (dès qu'elle apparaît) le bas de la bouteille
        // restent dans la zone, avec une petite marge.
        const half = TOTAL_H / (2 * (cfg.fill || 0.86) * introCam.zoom);
        const lo = TOTAL_H + dropY + 0.06 - half;
        const hi = bottleVis > 0 ? -0.3 * (1 - bottleVis) - 0.04 + half : Infinity;
        introCam.focus = Math.min(Math.max(introCam.focus, lo), Math.max(lo, hi));
      }
      const land = it - tLand;
      if (land >= 0) landing = Math.sin(Math.min(1, land / INTRO.settle) * Math.PI) * Math.exp(-land * 5);
      if (land > INTRO.settle) s.introDone = true;
    }
    const userActive = drag || now() - s.lastUser < 1000;
    const snap = reducedMotion || !s.pos; // mouvement réduit ou premier placement : d'un coup
    const go = (st, target, stiff) => {
      if (snap) {
        st.x = target;
        st.v = 0;
      } else spring(st, target, stiff, dt);
    };

    // ----- Rotation -----
    if (!drag) {
      s.yaw += s.yawVel * dt;
      s.yawVel *= Math.exp(-3 * dt); // inertie qui s'éteint
    }
    if (!userActive && cfg.yaw !== null && cfg.yaw !== undefined) {
      // ressort sur l'écart (par le chemin le plus court) vers l'angle visé
      const d = { x: wrapAngle(s.yaw - cfg.yaw), v: s.yawEaseV };
      if (reducedMotion) d.x *= 1 - damp(10, dt);
      else spring(d, 0, 4.5, dt);
      s.yaw = cfg.yaw + d.x;
      s.yawEaseV = d.v;
    } else {
      s.yawEaseV = 0;
      if (!userActive && !reducedMotion) s.yaw += 0.32 * dt; // rotation lente au repos
    }
    if (!drag || !drag.mouse) go(s.tilt, cfg.tilt || 0, 4.5);

    // ----- Placement sur la zone (en unités 3D) -----
    // Taille à l'écran = hauteur de la zone × fill × zoom (le FOV et la distance s'annulent).
    const upp = (2 * CAM_Z * Math.tan((FOV * Math.PI) / 360)) / size.h; // unités par pixel
    const r = zone.r;
    if (introCam) {
      Object.assign(s.zoom, { x: introCam.zoom, v: 0 });
      Object.assign(s.focus, { x: introCam.focus, v: 0 });
    } else {
      go(s.zoom, cfg.zoom || 1, 5.5);
      go(s.focus, cfg.focus || CENTER_Y, 5.5);
    }
    const px = Math.min((r.height * cfg.fill) / TOTAL_H, (r.width * 0.8) / 1.0);
    const target = {
      x: (r.left + r.width / 2 - size.w / 2) * upp,
      y: -(r.top + r.height / 2 - size.h / 2) * upp,
    };
    // Changement de zone : la bouteille part d'où elle est et glisse vers la nouvelle.
    // Pendant le défilement, elle suit sa zone exactement (aucun retard).
    if (zone.el !== s.zoneEl) {
      if (s.pos && s.zoneEl) {
        s.offX.x = s.pos.x - target.x;
        s.offY.x = s.pos.y - target.y;
      }
      s.zoneEl = zone.el;
    }
    if (!s.pos) {
      s.offX = sp();
      s.offY = sp();
    }
    const stiff = narrow ? 9 : 11;
    go(s.offX, 0, stiff);
    go(s.offY, 0, stiff);
    go(s.base, px * upp, stiff);
    // Découpage au cadre : s'installe avec la bouteille, se retire vite en quittant la zone.
    go(s.clip, narrow && name === 'chapters' ? 1 : 0, name === 'chapters' ? stiff : 16);
    s.pos = { x: target.x + s.offX.x, y: target.y + s.offY.x, sc: s.base.x * s.zoom.x };

    // ----- Démo -----
    s.demoW = reducedMotion ? (name === 'demo' ? 1 : 0) : lerp(s.demoW, name === 'demo' ? 1 : 0, damp(5, dt));
    const w = s.demoW;
    // ressort de la secousse
    s.shakeVel += (-70 * s.shakeAng - 7 * s.shakeVel) * dt;
    s.shakeAng += s.shakeVel * dt;
    if (s.released) s.releaseT += dt;
    s.dissolveShown = lerp(s.dissolveShown, s.dissolve, damp(3, dt));
    // « Bois » : on retire d'abord la dosette (posée à côté), puis on boit
    let drinkAngle = 0;
    let fill = 1;
    let lift = 0;
    if (s.drinkT >= 0) {
      if (s.drinkT < 1) s.drinkT = Math.min(1, s.drinkT + dt / 2.3);
      const d = s.drinkT;
      lift = smoothstep(0, 0.24, d);
      const up = d < 0.24 ? 0 : d < 0.45 ? smooth((d - 0.24) / 0.21) : d < 0.75 ? 1 : 1 - smooth((d - 0.75) / 0.25);
      drinkAngle = d >= 1 ? 0 : 1.15 * up;
      fill = lerp(1, FILL_END, smoothstep(0.42, 0.78, d));
    }

    anchor.position.set(s.pos.x + s.shakeAng * 0.35 * s.pos.sc * w, s.pos.y - s.focus.x * s.pos.sc, 0);
    anchor.scale.setScalar(s.pos.sc);
    pivot.rotation.set(s.tilt.x, s.yaw, (s.shakeAng + drinkAngle) * w);
    dosePivot.rotation.set(s.tilt.x, s.yaw, s.shakeAng * w);

    // Intro : la bouteille monte et apparaît pendant que la dosette tombe
    bottle.visible = bottleVis > 0.002;
    bottle.position.y = -CENTER_Y - 0.3 * (1 - bottleVis);
    glassMat.opacity = 0.3 * bottleVis;
    liquidMat.opacity = 0.8 * bottleVis;
    labelMat.opacity = bottleVis;
    labelMat.depthWrite = bottleVis > 0.999; // pendant le fondu, ne cache pas la boisson
    neckRingMat.opacity = 0.55 * bottleVis;

    // Dosette : chute de l'intro, puis (pour boire) retirée et posée à côté de la bouteille
    const off = lift * w;
    dose.position.set(
      -1.02 * smoothstep(0, 0.6, off),
      NECK_TOP + dropY + lerp(0, -at(70) - NECK_TOP, smoothstep(0.35, 1, off)) + 0.55 * Math.sin(Math.PI * off),
      0,
    );
    dose.rotation.z = 0.12 * clamp(dropY / INTRO.drop, 0, 1); // un peu penchée en l'air
    dose.scale.set(1 + 0.03 * landing, 1 - 0.05 * landing, 1 + 0.03 * landing);
    clipMat.emissiveIntensity = 0.25 + 2.2 * landing;

    // Appui : maintenir = le bouton descend d'un quart (la membrane se tend) ; au clic,
    // le piston va jusqu'au bout, la membrane s'ouvre et la poudre tombe dans la bouteille.
    const travel = s.released ? lerp(0.25 * s.press0, 1, smooth(clamp(s.releaseT / 0.75, 0, 1))) : s.press * 0.25;
    const shownTravel = travel * w;
    plunger.position.y = -R(PUSH_MM) * shownTravel;
    powder.scale.y = Math.max(0.0001, R(POWDER_MM - PUSH_MM * shownTravel));
    const pulse = name === 'chapters' && s.chapter === 1 && !reducedMotion ? 0.5 + 0.5 * Math.sin(t / 260) : 0;
    buttonMat.emissiveIntensity = 0.18 + 0.5 * s.press * w + 0.35 * pulse;
    const open = (s.released ? lerp(0.06 * s.press0, 1, smoothstep(0, 0.22, s.releaseT)) : s.press * 0.06) * w;
    for (const p of petals) p.rotation.z = 1.4 * open;

    // Boisson : niveau, trouble pendant le mélange, vague
    const shownFill = lerp(1, fill, w);
    liquid.scale.y = shownFill;
    const cloud = s.released ? Math.min(1, s.releaseT * 1.5) * (1 - s.dissolveShown) * 0.7 * w : 0;
    liquidMat.color.copy(COLORS.liquid).lerp(COLORS.cloudy, cloud);
    wobble.value.set(-s.shakeAng * 1.5 * w + Math.sin(t / 140) * Math.abs(s.shakeVel) * 0.01, -s.yawVel * 0.025);
    shadowMat.opacity = (1 - Math.min(0.6, Math.abs(drinkAngle * w))) * bottleVis;

    // Particules : visibles seulement dans la démo, après l'appui
    particles.visible = s.released && w > 0.5 && s.dissolveShown < 0.98;
    if (particles.visible) {
      stepParticles(dt, shownFill);
      pMat.opacity = clamp(1 - s.dissolveShown * 1.05, 0, 1);
      pMat.size = 0.06 * s.pos.sc * (1 - 0.6 * s.dissolveShown);
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
      const maxR = y > 1.97 ? 0.15 : y > 1.78 ? 0.26 : 0.42; // goulot, épaule, corps
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
    Object.assign(s, { press: 0, press0: 0, released: false, releaseT: 0, dissolve: 0, dissolveShown: 0, shakeAng: 0, shakeVel: 0, drinkT: -1 });
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
      s.press0 = s.press;
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
      Object.assign(s, { press: 1, press0: 1, released: true, releaseT: 5 });
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
      narrowMq.removeEventListener('change', onNarrowChange);
      renderer.setScissorTest(false);
      canvas.style.transform = '';
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
