import { FILTERS } from './filters.js';
import { Renderer } from './renderer.js';
import { HandTracker, HAND_CONNECTIONS, THUMB_TIP, INDEX_TIP } from './tracker.js';
import { PointSmoother } from './smoothing.js';
import { Capture, stamp } from './capture.js';
import { GestureSequence } from './gestures.js';
import { PersonSegmenter } from './segmenter.js';
import { bgStore } from './bgstore.js';

const $ = (id) => document.getElementById(id);

// Embedded mode: the page runs inside the browser extension's panel on a video-call
// site. Frames arrive as ImageBitmaps from the host page instead of from a camera.
const EMBED = new URLSearchParams(location.search).has('embed') && window.parent !== window;
if (EMBED) document.body.classList.add('embed');

/** A canvas that quacks like a <video> so the rest of the app doesn't care. */
function makeFrameSource() {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  Object.assign(c, { videoWidth: 0, videoHeight: 0, readyState: 0, currentTime: 0, paused: false });
  c.push = (bitmap) => {
    if (c.width !== bitmap.width || c.height !== bitmap.height) {
      c.width = bitmap.width;
      c.height = bitmap.height;
    }
    ctx.drawImage(bitmap, 0, 0);
    c.videoWidth = bitmap.width;
    c.videoHeight = bitmap.height;
    c.readyState = 4;
    c.currentTime += 1;
  };
  return c;
}

const video = EMBED ? makeFrameSource() : $('video');
const glCanvas = $('gl');
const overlay = $('overlay');
const octx = overlay.getContext('2d');

// ---------------------------------------------------------------------------
// Settings (persisted per device)
// ---------------------------------------------------------------------------
const STORE_KEY = 'rectfilter.settings.v1';
const DEFAULTS = {
  filter: 0, shape: 'auto', invert: false, skeleton: true, outline: false,
  smooth: 5, feather: 2, timer: 5, quality: 0.75, camera: 'user', engine: 'auto',
  gesture: true,
};
const settings = { ...DEFAULTS, ...loadSettings(), mirror: !EMBED };

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
  try {
    const { mirror, ...rest } = settings; // mirror follows the active camera
    localStorage.setItem(STORE_KEY, JSON.stringify(rest));
  } catch { /* storage unavailable (private mode) */ }
}
if (!FILTERS.some((f) => f.id === settings.filter)) settings.filter = 0;

// ---------------------------------------------------------------------------
// Core objects & state
// ---------------------------------------------------------------------------
let renderer;
try {
  renderer = new Renderer(glCanvas);
} catch (err) {
  showStartError(err.message);
}
const tracker = new HandTracker();
const smoother = new PointSmoother(4);
smoother.configure(settings.smooth);
const capture = new Capture(glCanvas, overlay);
const gestures = new GestureSequence();
const segmenter = new PersonSegmenter();
const VANISH_SECONDS = 0.6; // duration of the blur-dissolve

const state = {
  running: false,
  stream: null,
  facing: 'user',
  hands: [],
  lastVideoTime: -1,
  lastDetectTs: 0,
  lastFrameTs: 0,
  corners: null,
  alpha: 0,
  lastSeen: -1e9,
  map: { x: 0, y: 0, w: 1, h: 1 },
  scale: 1, // canvas px per CSS px
  dirty: true,
  wantSnapshot: false,
  countdownTimer: null,
  manual: null, // { a: [x,y], b: [x,y], dragging }
  fpsFrames: 0,
  fpsSince: 0,
  fps: 0,
  detectMs: 0,
  trackerStatus: 'loading',
  everSawHands: false,
  hintTimer: null,
  poses: [],          // pose of each detected hand ('fist' | 'v' | 'other')
  gestureArmed: false,
  vanish: { target: 0, t: 0 },
  vanishPending: false, // vanish requested before a background was captured
};

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function setStatus(text, level) {
  $('status-text').textContent = text;
  $('status-dot').className = 'dot' + (level ? ' ' + level : '');
}

function showStartError(msg) {
  const el = $('start-error');
  el.textContent = msg;
  el.hidden = false;
}

function flash() {
  const el = $('countdown');
  $('countdown-num').textContent = '';
  $('countdown-msg').hidden = true;
  el.hidden = false;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => {
    if (!state.countdownTimer) el.hidden = true;
    $('countdown-msg').hidden = false;
    el.classList.remove('flash');
  }, 360);
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------
const filterKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

function buildFilterChips() {
  const wrap = $('filters');
  FILTERS.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.id = String(f.id);
    const key = filterKeys[i] ? `<span class="key">${filterKeys[i]}</span>` : '<span class="key">&nbsp;</span>';
    b.innerHTML = `<span class="swatch" style="background:${f.swatch}"></span><span>${f.name}</span>${key}`;
    b.addEventListener('click', () => selectFilter(f.id));
    wrap.appendChild(b);
  });
  refreshFilterChips(false);
}

function refreshFilterChips(scroll = true) {
  for (const b of $('filters').children) {
    const on = Number(b.dataset.id) === settings.filter;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    if (on && scroll) b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function currentFilter() { return FILTERS.find((f) => f.id === settings.filter) || FILTERS[0]; }

function selectFilter(id) {
  settings.filter = id;
  saveSettings();
  refreshFilterChips();
  state.dirty = true;
  const f = currentFilter();
  if (f.needsBackground && state.running && !haveBackground()) {
    toast("Per l'effetto Invisibile serve lo sfondo vuoto: esci dall'inquadratura.");
    startBackgroundCapture();
  } else {
    toast(f.name, 1100);
  }
}

function cycleFilter(dir) {
  const i = FILTERS.findIndex((f) => f.id === settings.filter);
  selectFilter(FILTERS[(i + dir + FILTERS.length) % FILTERS.length].id);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
function stopStream() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

async function startCamera(videoConstraints) {
  stopStream();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, ...videoConstraints },
  });
  state.stream = stream;
  video.srcObject = stream;
  if (video.readyState < 1) {
    await new Promise((res) => video.addEventListener('loadedmetadata', res, { once: true }));
  }
  await video.play();

  const track = stream.getVideoTracks()[0];
  const s = track.getSettings ? track.getSettings() : {};
  const requested = typeof videoConstraints.facingMode === 'string'
    ? videoConstraints.facingMode
    : videoConstraints.facingMode?.exact || videoConstraints.facingMode?.ideal;
  state.facing = s.facingMode || requested || 'user';
  settings.mirror = state.facing !== 'environment';
  $('opt-mirror').checked = settings.mirror;
  state.lastVideoTime = -1;
  state.hands = [];
  state.dirty = true;

  track.addEventListener('ended', () => {
    if (state.stream !== stream) return;
    toast('La fotocamera si è interrotta. Toccala per riavviarla.', 4000);
    $('start').hidden = false;
    state.running = false;
  });

  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    $('btn-switch').hidden = cams.length < 2;
  } catch { /* ignore */ }
}

async function switchCamera() {
  const prevId = state.stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
  try {
    if (state.facing === 'user' || state.facing === 'environment') {
      const next = state.facing === 'user' ? 'environment' : 'user';
      await startCamera({ facingMode: { exact: next } });
      const newId = state.stream.getVideoTracks()[0].getSettings().deviceId;
      if (!prevId || newId !== prevId) { settings.camera = next; saveSettings(); return finishSwitch(); }
    }
  } catch { /* fall back to cycling device ids */ }
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const idx = cams.findIndex((d) => d.deviceId === prevId);
    const next = cams[(idx + 1) % cams.length];
    await startCamera({ deviceId: { exact: next.deviceId } });
    finishSwitch();
  } catch (err) {
    toast('Impossibile cambiare fotocamera: ' + err.message);
  }
}

function finishSwitch() {
  renderer.clearBackground();
  refreshBgButton();
  state.vanish.target = 0;
  state.vanish.t = 0;
  $('btn-vanish').classList.remove('active');
  refreshGestureHud();
  smoother.reset();
  state.corners = null;
  state.alpha = 0;
}

// ---------------------------------------------------------------------------
// Background capture (for the "Invisibile" filter)
// ---------------------------------------------------------------------------
function startBackgroundCapture(minSeconds = 0) {
  if (!state.running) return;
  if (state.countdownTimer) {
    if (minSeconds > 0) return; // already counting down
    cancelCountdown();
    state.vanishPending = false;
    return;
  }
  let left = Math.max(Number(settings.timer) || 0, minSeconds);
  if (left <= 0) { doCaptureBackground(); return; }
  const el = $('countdown');
  el.hidden = false;
  $('countdown-msg').textContent = "Esci dall'inquadratura";
  $('countdown-num').textContent = String(left);
  $('btn-bg').classList.add('busy');
  state.countdownTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      cancelCountdown();
      doCaptureBackground();
    } else {
      $('countdown-num').textContent = String(left);
    }
  }, 1000);
}

function cancelCountdown() {
  clearInterval(state.countdownTimer);
  state.countdownTimer = null;
  $('countdown').hidden = true;
  $('btn-bg').classList.remove('busy');
}

function doCaptureBackground() {
  if (state.countdownTimer) cancelCountdown();
  if (!video.videoWidth) {
    toast('Cattura dello sfondo non riuscita, riprova.');
    return;
  }
  const shot = document.createElement('canvas');
  shot.width = video.videoWidth;
  shot.height = video.videoHeight;
  shot.getContext('2d').drawImage(video, 0, 0);
  setBackground(shot, 'capture');
  flash();
  state.dirty = true;
  if (state.vanishPending) {
    state.vanishPending = false;
    setVanish(true, { silent: true });
    toast('Sfondo catturato! Rientra pure: sei invisibile. ✊ → ✌️ per riapparire.', 4200);
    return;
  }
  if (state.setupCapture) {
    state.setupCapture = false;
    toast('Sfondo pronto! Quando vuoi sparire fai ✊ → ✌️.', 4200);
    return;
  }
  if (!currentFilter().needsBackground) {
    settings.filter = FILTERS.find((f) => f.needsBackground).id;
    saveSettings();
    refreshFilterChips();
  }
  toast('Sfondo catturato! Ora fai il rettangolo con le mani per sparire.', 3200);
}

// ---------------------------------------------------------------------------
// Background plate: uploaded image or photo of the empty scene, kept between sessions
// ---------------------------------------------------------------------------
const bg = { source: null, kind: null };
const BG_MAX_SIDE = 1920;

/** Stores `image` (anything drawable) as the background and fits it to the camera. */
function setBackground(image, kind, { persist = true } = {}) {
  const iw = image.videoWidth || image.naturalWidth || image.width;
  const ih = image.videoHeight || image.naturalHeight || image.height;
  if (!iw || !ih) return false;
  const k = Math.min(1, BG_MAX_SIDE / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.round(iw * k);
  c.height = Math.round(ih * k);
  c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
  bg.source = c;
  bg.kind = kind;
  fitBackground();
  refreshBgButton();
  state.dirty = true;
  if (persist) {
    bgStore.save({ dataUrl: c.toDataURL('image/jpeg', 0.9), kind }).then((ok) => {
      if (!ok) toast('Sfondo impostato, ma non sono riuscito a salvarlo per la prossima volta.', 4000);
    });
  }
  return true;
}

/** Draws the stored background at the camera's resolution (cover fit) into the renderer. */
function fitBackground() {
  if (!bg.source || !renderer || !video.videoWidth) return false;
  const w = video.videoWidth;
  const h = video.videoHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const k = Math.max(w / bg.source.width, h / bg.source.height);
  const dw = bg.source.width * k;
  const dh = bg.source.height * k;
  // An uploaded picture should read the right way round in the mirrored selfie view.
  if (bg.kind === 'upload' && settings.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(bg.source, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return renderer.captureBackground(c, w, h);
}

function haveBackground() {
  return renderer.hasBackgroundFor(video) || fitBackground();
}

function clearBackground() {
  bg.source = null;
  bg.kind = null;
  renderer.clearBackground();
  bgStore.clear();
  refreshBgButton();
  state.dirty = true;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function applyStored(value) {
  if (!value || !value.dataUrl) {
    bg.source = null;
    bg.kind = null;
    renderer?.clearBackground();
    refreshBgButton();
    return;
  }
  try {
    setBackground(await loadImage(value.dataUrl), value.kind || 'capture', { persist: false });
  } catch { /* corrupted entry: ignore */ }
}

const bgReady = bgStore.load().then(applyStored);
bgStore.onChange(applyStored);

async function uploadBackground(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    setBackground(await loadImage(url), 'upload');
    closeBgSetup();
    toast('Sfondo impostato! Quando vuoi sparire fai ✊ → ✌️.', 4200);
  } catch {
    toast('Non riesco a leggere questa immagine. Prova con un JPG o un PNG.', 4000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function photographBackground() {
  if (!state.running && !EMBED) await start();
  if (!state.running) {
    toast(EMBED ? 'Accendi prima la webcam nella chiamata.' : 'Avvia prima la fotocamera.', 3500);
    return;
  }
  closeBgSetup();
  if (state.countdownTimer) return;
  state.setupCapture = true;
  startBackgroundCapture();
}

function openBgSetup() {
  $('bg-status').textContent = bg.source
    ? (bg.kind === 'upload' ? 'Sfondo attuale: immagine caricata.' : 'Sfondo attuale: foto dello sfondo vuoto.')
    : 'Nessuno sfondo impostato.';
  $('bg-remove').hidden = !bg.source;
  $('bg-setup').hidden = false;
}

function closeBgSetup() { $('bg-setup').hidden = true; }

/** Offers the setup once, as soon as the camera is on and no background exists yet. */
async function maybeOfferBgSetup(force = false) {
  await bgReady;
  if (state.setupOffered && !force) return;
  if (bg.source && !force) return;
  state.setupOffered = true;
  openBgSetup();
}

function refreshBgButton() {
  $('btn-bg').classList.toggle('active', !!bg.source || !!renderer?.bgSize);
}

// ---------------------------------------------------------------------------
// Vanish: fist → V makes you disappear (only the background is left)
// ---------------------------------------------------------------------------
function setVanish(on, { silent = false } = {}) {
  if (!state.running) return;
  if (on && !haveBackground()) {
    state.vanishPending = true;
    toast("Per sparire mi serve lo sfondo vuoto: esci dall'inquadratura!", 4200);
    startBackgroundCapture(3);
    return;
  }
  state.vanishPending = false;
  state.vanish.target = on ? 1 : 0;
  state.dirty = true;
  $('btn-vanish').classList.toggle('active', on);
  if (on) ensureSegmenter();
  if (!silent) toast(on ? '✌️ Sei sparito' : '✌️ Sei riapparso', 1600);
  refreshGestureHud();
}

let segmenterLoading = null;
function ensureSegmenter() {
  if (segmenter.ready || segmenterLoading || !tracker.vision) return;
  segmenterLoading = segmenter.init(tracker.lib, tracker.vision, tracker.delegate)
    .catch((err) => {
      // Without segmentation the effect still works using the difference from the background.
      console.warn('Segmentazione persona non disponibile', err);
    })
    .finally(() => { segmenterLoading = null; });
}

function updateVanish(fresh, dt) {
  const v = state.vanish;
  if (v.target > 0 && !haveBackground()) {
    // e.g. the iPad was rotated and the video size changed.
    v.target = 0;
    $('btn-vanish').classList.remove('active');
    toast('Lo sfondo non corrisponde più alla fotocamera: ricatturalo per sparire di nuovo.', 4200);
  }
  const step = dt / VANISH_SECONDS;
  v.t = v.target > v.t ? Math.min(v.target, v.t + step) : Math.max(v.target, v.t - step);
  if (v.t > 0 && fresh && segmenter.ready) {
    try {
      const mask = segmenter.segment(video, performance.now());
      if (mask) renderer.updateMask(mask);
    } catch (err) {
      console.warn(err);
    }
  }
  if (v.t === 0 && renderer.hasMask) {
    renderer.clearMask();
    segmenter.resetHistory();
  }
}

function refreshGestureHud() {
  const el = $('gesture-hud');
  let text = '';
  if (state.vanish.target > 0) text = settings.gesture ? '👻 Invisibile · ✊ → ✌️ per riapparire' : '👻 Invisibile';
  if (settings.gesture && state.gestureArmed) {
    text = state.vanish.target > 0 ? '✊ ok · ora ✌️ per riapparire' : '✊ ok · ora ✌️ per sparire';
  }
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('armed', settings.gesture && state.gestureArmed);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
function layout() {
  if (EMBED) {
    // Output at the camera's own resolution; the panel only previews it.
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (glCanvas.width !== w || glCanvas.height !== h) {
      renderer.resize(w, h);
      overlay.width = w;
      overlay.height = h;
    }
    state.scale = 1 / previewFit().k;
    state.map = { x: 0, y: 0, w, h };
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.max(0.5, dpr * Number(settings.quality));
  const cssW = glCanvas.clientWidth || window.innerWidth;
  const cssH = glCanvas.clientHeight || window.innerHeight;
  const w = Math.max(1, Math.round(cssW * scale));
  const h = Math.max(1, Math.round(cssH * scale));
  if (glCanvas.width !== w || glCanvas.height !== h) {
    renderer.resize(w, h);
    overlay.width = w;
    overlay.height = h;
    state.dirty = true;
  }
  state.scale = w / cssW;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const s = Math.max(w / vw, h / vh);
  state.map = { x: (w - vw * s) / 2, y: (h - vh * s) / 2, w: vw * s, h: vh * s };
}

/** How the output canvas is fitted (object-fit: contain) in the embedded preview. */
function previewFit() {
  const r = glCanvas.getBoundingClientRect();
  const w = glCanvas.width || 1;
  const h = glCanvas.height || 1;
  const k = Math.min(r.width / w, r.height / h) || 1;
  return { r, k, ox: (r.width - w * k) / 2, oy: (r.height - h * k) / 2 };
}

function toCanvas(lm) {
  const x = settings.mirror ? 1 - lm.x : lm.x;
  return [state.map.x + x * state.map.w, state.map.y + lm.y * state.map.h];
}

function rectFrom(p, q) {
  const x0 = Math.min(p[0], q[0]);
  const x1 = Math.max(p[0], q[0]);
  const y0 = Math.min(p[1], q[1]);
  const y1 = Math.max(p[1], q[1]);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * Builds the quad from the detected hands.
 * Two hands: [left index, right index, right thumb, left thumb] (as in the reel).
 * One hand: axis-aligned rectangle with thumb and index tips on opposite corners.
 */
function handsPolygon(hands) {
  const pts = hands.map((h) => ({
    thumb: toCanvas(h[THUMB_TIP]),
    index: toCanvas(h[INDEX_TIP]),
    wrist: toCanvas(h[0]),
  }));
  if (pts.length >= 2 && settings.shape !== 'one') {
    const [a, b] = pts[0].wrist[0] <= pts[1].wrist[0] ? [pts[0], pts[1]] : [pts[1], pts[0]];
    return [a.index, b.index, b.thumb, a.thumb];
  }
  if (pts.length >= 1 && settings.shape !== 'two') {
    // With two hands in "one" mode, use the hand with the widest pinch.
    const span = (h) => Math.hypot(h.thumb[0] - h.index[0], h.thumb[1] - h.index[1]);
    const h = pts.reduce((best, cur) => (span(cur) > span(best) ? cur : best));
    return rectFrom(h.thumb, h.index);
  }
  return null;
}

function polyArea(p) {
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  return 0.5 * (Math.abs(cross(p[0], p[1], p[2])) + Math.abs(cross(p[0], p[2], p[3])));
}

function updateShape(now, fresh, dt) {
  const minArea = glCanvas.width * glCanvas.height * 0.0015;
  const invisible = state.vanish.target > 0;
  // Hands making the fist / V gesture don't draw the rectangle.
  const framing = settings.gesture
    ? state.hands.filter((_, i) => state.poses[i] !== 'fist' && state.poses[i] !== 'v')
    : state.hands;
  let poly = !invisible && framing.length ? handsPolygon(framing) : null;
  if (poly && polyArea(poly) < minArea) poly = null;
  if (invisible) state.manual = null;

  if (poly) {
    state.manual = null;
    if (fresh) {
      if (!state.corners || state.alpha < 0.02) smoother.reset();
      const dtDetect = state.lastDetectTs ? Math.max(0.001, (now - state.lastDetectTs) / 1000) : 1 / 30;
      state.corners = smoother.filter(poly, dtDetect);
    }
    state.lastSeen = now;
  } else if (state.manual) {
    const mp = rectFrom(state.manual.a, state.manual.b);
    if (polyArea(mp) >= minArea || state.manual.dragging) {
      state.corners = mp;
      state.lastSeen = now;
    }
  }

  const visible = !!state.corners && now - state.lastSeen < 160;
  const target = visible ? 1 : 0;
  state.alpha += (target - state.alpha) * (1 - Math.exp(-dt / 0.09));
  if (Math.abs(target - state.alpha) < 0.002) state.alpha = target;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function drawOverlay() {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!settings.skeleton || !state.hands.length || state.vanish.t > 0 || state.vanish.target > 0) return;
  const k = Math.max(0.6, overlay.height / 720);
  octx.lineCap = 'round';
  octx.lineJoin = 'round';
  for (const hand of state.hands) {
    const pts = hand.map(toCanvas);
    octx.strokeStyle = '#ff2a2a';
    octx.lineWidth = 2.6 * k;
    octx.beginPath();
    for (const [i, j] of HAND_CONNECTIONS) {
      octx.moveTo(pts[i][0], pts[i][1]);
      octx.lineTo(pts[j][0], pts[j][1]);
    }
    octx.stroke();
    octx.fillStyle = '#2bff4f';
    for (const p of pts) {
      octx.beginPath();
      octx.arc(p[0], p[1], 3.6 * k, 0, Math.PI * 2);
      octx.fill();
    }
    octx.strokeStyle = '#ffffff';
    octx.lineWidth = 2 * k;
    for (const i of [THUMB_TIP, INDEX_TIP]) {
      octx.beginPath();
      octx.arc(pts[i][0], pts[i][1], 8 * k, 0, Math.PI * 2);
      octx.stroke();
    }
  }
}

function updateStats(now) {
  state.fpsFrames += 1;
  if (now - state.fpsSince >= 1000) {
    state.fps = Math.round((state.fpsFrames * 1000) / (now - state.fpsSince));
    state.fpsFrames = 0;
    state.fpsSince = now;
    if (state.trackerStatus === 'ready') {
      const n = state.hands.length;
      const label = n === 0 ? 'Nessuna mano' : n === 1 ? '1 mano' : '2 mani';
      setStatus(`${label} · ${state.fps} fps`, n ? 'ok' : 'warn');
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function loop(now) {
  requestAnimationFrame(loop);
  tick(now);
}

function tick(now) {
  if (!state.running || !renderer || video.readyState < 2 || !video.videoWidth) return;

  layout();
  if (bg.source && !renderer.hasBackgroundFor(video)) fitBackground(); // camera size changed
  const fresh = video.currentTime !== state.lastVideoTime;
  if (!fresh && !state.dirty) return;

  const dt = state.lastFrameTs ? Math.min(0.25, (now - state.lastFrameTs) / 1000) : 1 / 30;
  state.lastFrameTs = now;

  let detected = false;
  if (fresh) {
    state.lastVideoTime = video.currentTime;
    if (tracker.landmarker) {
      const t0 = performance.now();
      try {
        state.hands = tracker.detect(video, now);
        detected = true;
        if (state.hands.length) state.everSawHands = true;
      } catch (err) {
        console.error(err);
        state.hands = [];
      }
      state.detectMs = performance.now() - t0;
    }
  }
  if (detected) {
    if (settings.gesture) {
      const g = gestures.update(state.hands, tracker.labels, video.videoWidth, video.videoHeight, now);
      state.poses = g.poses;
      if (g.armed !== state.gestureArmed) { state.gestureArmed = g.armed; refreshGestureHud(); }
      if (g.triggered) setVanish(state.vanish.target === 0);
    } else {
      state.poses = [];
    }
  }
  updateVanish(fresh, dt);
  updateShape(now, detected, dt);
  if (detected) state.lastDetectTs = now;

  renderer.render({
    video,
    uploadVideo: fresh || state.dirty,
    map: state.map,
    mirror: settings.mirror,
    corners: state.corners || [[0, 0], [0, 0], [0, 0], [0, 0]],
    alpha: state.alpha,
    filter: settings.filter,
    time: now / 1000,
    invert: settings.invert,
    outline: settings.outline ? 3 * state.scale : 0,
    feather: settings.feather * state.scale,
    vanish: state.vanish.t,
    bgFull: bg.kind === 'upload',
  });
  drawOverlay();
  // Keep animating fades.
  state.dirty = (state.alpha > 0 && state.alpha < 1) || state.vanish.t !== state.vanish.target;

  if (state.wantSnapshot) {
    state.wantSnapshot = false;
    capture.snapshot(settings.skeleton).then((blob) => blob && showPreview(blob, 'photo'));
  }
  updateStats(now);
}

// ---------------------------------------------------------------------------
// Photo / video
// ---------------------------------------------------------------------------
let previewUrl = null;
let previewFile = null;

function showPreview(blob, kind) {
  closePreview();
  previewUrl = URL.createObjectURL(blob);
  const ext = 'jpg';
  const name = `rectfilter-${stamp()}.${ext}`;
  try { previewFile = new File([blob], name, { type: blob.type }); } catch { previewFile = null; }
  const media = $('preview-media');
  media.innerHTML = '';
  const el = document.createElement('img');
  el.alt = 'Foto scattata';
  el.src = previewUrl;
  media.appendChild(el);
  const dl = $('btn-download');
  dl.href = previewUrl;
  dl.download = name;
  const canShare = !!(previewFile && navigator.canShare && navigator.canShare({ files: [previewFile] }));
  $('btn-share').hidden = !canShare;
  $('preview').hidden = false;
}

function closePreview() {
  $('preview').hidden = true;
  $('preview-media').innerHTML = '';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  previewFile = null;
}

function takePhoto() {
  if (!state.running) return;
  state.wantSnapshot = true;
  state.dirty = true;
  flash();
}

// ---------------------------------------------------------------------------
// Manual rectangle (touch / mouse) — handy without hands or for quick tests
// ---------------------------------------------------------------------------
function pointerPos(e) {
  if (EMBED) {
    // The preview is letterboxed and flipped horizontally (selfie view).
    const { r, k, ox, oy } = previewFit();
    return [glCanvas.width - (e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k];
  }
  const r = glCanvas.getBoundingClientRect();
  return [(e.clientX - r.left) * state.scale, (e.clientY - r.top) * state.scale];
}

glCanvas.addEventListener('pointerdown', (e) => {
  if (!state.running) return;
  if (document.body.classList.contains('ui-hidden')) { setUiHidden(false); return; }
  if (!$('settings').hidden) { $('settings').hidden = true; return; }
  glCanvas.setPointerCapture(e.pointerId);
  const p = pointerPos(e);
  state.manual = { a: p, b: p, dragging: true, moved: false };
  state.dirty = true;
});
glCanvas.addEventListener('pointermove', (e) => {
  if (!state.manual?.dragging) return;
  state.manual.b = pointerPos(e);
  const d = Math.hypot(state.manual.b[0] - state.manual.a[0], state.manual.b[1] - state.manual.a[1]);
  if (d > 8 * state.scale) state.manual.moved = true;
  state.dirty = true;
});
const endDrag = () => {
  if (!state.manual) return;
  state.manual.dragging = false;
  if (!state.manual.moved) { state.manual = null; state.lastSeen = -1e9; }
  state.dirty = true;
};
glCanvas.addEventListener('pointerup', endDrag);
glCanvas.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------------------
// Controls wiring
// ---------------------------------------------------------------------------
function setUiHidden(hidden) {
  document.body.classList.toggle('ui-hidden', hidden);
  if (hidden) $('settings').hidden = true;
}

function setInvert(v) {
  settings.invert = v;
  $('opt-invert').value = v ? '1' : '0';
  $('btn-invert').classList.toggle('active', v);
  saveSettings();
  state.dirty = true;
}

function toggleFullscreen() {
  const d = document;
  const el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  } else {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el);
  }
}

function initControls() {
  buildFilterChips();
  $('btn-full').hidden = !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

  $('btn-bg').addEventListener('click', () => {
    if (state.countdownTimer) { cancelCountdown(); state.vanishPending = false; return; }
    openBgSetup();
  });
  $('bg-upload').addEventListener('click', () => $('bg-file').click());
  $('bg-file').addEventListener('change', (e) => { uploadBackground(e.target.files[0]); e.target.value = ''; });
  $('bg-photo').addEventListener('click', photographBackground);
  $('bg-later').addEventListener('click', closeBgSetup);
  $('bg-remove').addEventListener('click', () => {
    if (state.vanish.target > 0) setVanish(false, { silent: true });
    clearBackground();
    closeBgSetup();
    toast('Sfondo eliminato.');
  });
  $('btn-vanish').addEventListener('click', () => setVanish(state.vanish.target === 0));
  $('btn-switch').addEventListener('click', switchCamera);
  $('btn-full').addEventListener('click', toggleFullscreen);
  $('btn-settings').addEventListener('click', () => { $('settings').hidden = !$('settings').hidden; });
  $('btn-settings-close').addEventListener('click', () => { $('settings').hidden = true; });
  $('btn-hide').addEventListener('click', () => setUiHidden(true));
  $('btn-hide-restore').addEventListener('click', () => setUiHidden(false));
  $('btn-invert').addEventListener('click', () => setInvert(!settings.invert));
  $('btn-photo').addEventListener('click', takePhoto);
  $('btn-preview-close').addEventListener('click', closePreview);
  $('btn-share').addEventListener('click', async () => {
    if (!previewFile) return;
    try { await navigator.share({ files: [previewFile], title: 'Rectangular Filter' }); } catch { /* cancelled */ }
  });
  $('btn-bg-clear').addEventListener('click', () => {
    if (state.vanish.target > 0) setVanish(false, { silent: true });
    clearBackground();
    toast('Sfondo eliminato.');
  });

  // Settings form
  $('opt-shape').value = settings.shape;
  $('opt-invert').value = settings.invert ? '1' : '0';
  $('btn-invert').classList.toggle('active', settings.invert);
  $('opt-skeleton').checked = settings.skeleton;
  $('opt-gesture').checked = settings.gesture;
  $('opt-outline').checked = settings.outline;
  $('opt-smooth').value = settings.smooth;
  $('opt-smooth-val').textContent = settings.smooth;
  $('opt-feather').value = settings.feather;
  $('opt-feather-val').textContent = settings.feather;
  $('opt-timer').value = String(settings.timer);
  $('opt-quality').value = String(settings.quality);
  $('start-camera').value = settings.camera;
  $('opt-engine').value = settings.engine;

  const bind = (id, ev, fn) => $(id).addEventListener(ev, (e) => { fn(e.target); saveSettings(); state.dirty = true; });
  bind('opt-shape', 'change', (t) => { settings.shape = t.value; });
  bind('opt-invert', 'change', (t) => setInvert(t.value === '1'));
  bind('opt-skeleton', 'change', (t) => { settings.skeleton = t.checked; });
  bind('opt-gesture', 'change', (t) => {
    settings.gesture = t.checked;
    gestures.reset();
    state.gestureArmed = false;
    refreshGestureHud();
  });
  bind('opt-outline', 'change', (t) => { settings.outline = t.checked; });
  bind('opt-mirror', 'change', (t) => { settings.mirror = t.checked; fitBackground(); });
  bind('opt-smooth', 'input', (t) => {
    settings.smooth = Number(t.value);
    $('opt-smooth-val').textContent = t.value;
    smoother.configure(settings.smooth);
  });
  bind('opt-feather', 'input', (t) => { settings.feather = Number(t.value); $('opt-feather-val').textContent = t.value; });
  bind('opt-timer', 'change', (t) => { settings.timer = Number(t.value); });
  bind('opt-quality', 'change', (t) => { settings.quality = Number(t.value); });
  bind('start-camera', 'change', (t) => { settings.camera = t.value; });
  bind('opt-engine', 'change', (t) => {
    settings.engine = t.value;
    if (state.trackerStatus !== 'ready') return;
    setStatus('Cambio motore…', 'warn');
    state.trackerStatus = 'loading';
    tracker.setEngine(settings.engine)
      .then(() => { toast(`Motore: ${tracker.delegate}`); })
      .catch((err) => { toast('Motore non disponibile: ' + err.message, 4000); return tracker.setEngine('CPU'); })
      .finally(() => {
        state.trackerStatus = 'ready';
        refreshEngineLabel();
        segmenter.init(tracker.lib, tracker.vision, tracker.delegate).catch((err) => console.warn(err));
      });
  });

  // Keyboard shortcuts (PC)
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (!state.running) return;
    const k = e.key.toLowerCase();
    const fi = filterKeys.indexOf(e.key);
    if (fi >= 0 && FILTERS[fi]) { selectFilter(FILTERS[fi].id); return; }
    switch (k) {
      case 'arrowright': cycleFilter(1); break;
      case 'arrowleft': cycleFilter(-1); break;
      case 'b': startBackgroundCapture(); break;
      case 'v': setVanish(state.vanish.target === 0); break;
      case 'i': setInvert(!settings.invert); break;
      case 'p': case ' ': e.preventDefault(); takePhoto(); break;
      case 'c': if (!$('btn-switch').hidden) switchCamera(); break;
      case 'h': setUiHidden(!document.body.classList.contains('ui-hidden')); break;
      case 'f': toggleFullscreen(); break;
      case 's': $('settings').hidden = !$('settings').hidden; break;
      case 'escape': closeBgSetup(); $('settings').hidden = true; closePreview(); setUiHidden(false); break;
      default:
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.running && video.paused) {
      video.play().catch(() => {});
    }
  });
  window.addEventListener('resize', () => { state.dirty = true; });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
function cameraErrorMessage(err) {
  if (!window.isSecureContext) {
    return "La fotocamera funziona solo su HTTPS o su http://localhost. Apri l'app da un indirizzo https://.";
  }
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permesso fotocamera negato. Consentilo dalle impostazioni del browser (su iPad: Impostazioni › Safari › Fotocamera) e riprova.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nessuna fotocamera trovata su questo dispositivo.';
    case 'NotReadableError':
      return "La fotocamera è usata da un'altra app. Chiudila e riprova.";
    default:
      return 'Impossibile avviare la fotocamera: ' + (err?.message || err);
  }
}

async function start() {
  const btn = $('btn-start');
  $('start-error').hidden = true;
  if (!renderer) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showStartError(cameraErrorMessage({ name: 'Unsupported' }));
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Avvio…';
  try {
    await startCamera({ facingMode: settings.camera });
    $('start').hidden = true;
    state.running = true;
    state.dirty = true;
    maybeOfferBgSetup();
    if (state.trackerStatus === 'loading') setStatus('Carico il riconoscimento mani…', 'warn');
    if (state.trackerStatus === 'ready') onReadyAndRunning();
  } catch (err) {
    console.error(err);
    showStartError(cameraErrorMessage(err));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Avvia fotocamera';
  }
}

function refreshEngineLabel() {
  $('opt-engine-val').textContent = tracker.delegate ? `in uso: ${tracker.delegate}` : '';
}

function onReadyAndRunning() {
  toast('Mostra le mani alla fotocamera e forma un rettangolo con pollici e indici.', 4200);
  // If no hand shows up for a while, the GPU path may be misbehaving on this device.
  clearTimeout(state.hintTimer);
  state.hintTimer = setTimeout(() => {
    if (!state.everSawHands && state.running && tracker.delegate === 'GPU') {
      toast('Le mani non vengono riconosciute? Prova Impostazioni › Motore: CPU.', 6000);
    }
  }, 12000);
}

function initTracker() {
  setStatus('Carico il riconoscimento mani…', 'warn');
  tracker.init(settings.engine, (msg) => setStatus(msg, 'warn'))
    .then(() => {
      state.trackerStatus = 'ready';
      setStatus(`Pronto (${tracker.delegate})`, 'ok');
      refreshEngineLabel();
      ensureSegmenter(); // small model, preload it so the first ✌️ is instant
      if (state.running) onReadyAndRunning();
    })
    .catch((err) => {
      console.error(err);
      state.trackerStatus = 'error';
      setStatus('Riconoscimento mani non disponibile', 'err');
      toast('Non riesco a caricare il riconoscimento mani (serve internet al primo avvio). Puoi comunque disegnare il rettangolo col dito.', 6000);
    });
}

// ---------------------------------------------------------------------------
// Embedded mode (browser extension panel inside a video-call page)
// ---------------------------------------------------------------------------
function initEmbed() {
  $('start').hidden = true;
  $('opt-mirror').checked = false;
  $('opt-mirror').closest('label').hidden = true;
  const host = window.parent;
  const send = (msg, transfer) => host.postMessage({ source: 'rectfilter-panel', ...msg }, '*', transfer || []);

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== host || !d || d.source !== 'rectfilter-page' || d.type !== 'frame') return;
    const input = d.bitmap;
    if (!renderer || renderer.lost) { send({ type: 'result', id: d.id, bitmap: input }, [input]); return; }
    try {
      video.push(input);
      if (!state.running) {
        state.running = true;
        maybeOfferBgSetup();
        if (state.trackerStatus === 'ready') onReadyAndRunning();
      }
      tick(performance.now());
      // Snapshot synchronously, right after drawing.
      createImageBitmap(capture.compose(settings.skeleton))
        .then((out) => { input.close(); send({ type: 'result', id: d.id, bitmap: out }, [out]); })
        .catch(() => send({ type: 'result', id: d.id, bitmap: input }, [input]));
    } catch (err) {
      console.error(err);
      send({ type: 'result', id: d.id, bitmap: input }, [input]);
    }
  });
  send({ type: 'ready' });
}

initControls();
initTracker();
// "?setup" (from the extension popup): go straight to the background setup.
if (new URLSearchParams(location.search).has('setup')) maybeOfferBgSetup(true);
if (EMBED) {
  initEmbed();
} else {
  $('btn-start').addEventListener('click', start);
  requestAnimationFrame(loop);
}

// Expose a tiny debug hook (used by automated tests).
window.__rectfilter = { state, settings, tracker, segmenter, gestures, selectFilter, doCaptureBackground, setVanish };
