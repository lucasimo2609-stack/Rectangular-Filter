// Photo snapshots and video recording of the composited output (WebGL canvas + hand overlay).

const MAX_REC_SIDE = 1920;

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ }
  }
  return '';
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class Capture {
  constructor(glCanvas, overlayCanvas) {
    this.gl = glCanvas;
    this.overlay = overlayCanvas;
    this.rec = null;
    this.recCanvas = null;
    this.recCtx = null;
    this.chunks = [];
    this.mime = pickMime();
  }

  get canRecord() {
    return this.mime !== null && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  get recording() { return !!this.rec && this.rec.state === 'recording'; }

  _compose(ctx, w, h, withOverlay) {
    ctx.drawImage(this.gl, 0, 0, w, h);
    if (withOverlay) ctx.drawImage(this.overlay, 0, 0, w, h);
  }

  /** Must be called right after rendering, in the same animation frame. */
  snapshot(withOverlay) {
    const c = document.createElement('canvas');
    c.width = this.gl.width;
    c.height = this.gl.height;
    this._compose(c.getContext('2d'), c.width, c.height, withOverlay);
    return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
  }

  start() {
    if (!this.canRecord) throw new Error('La registrazione video non è supportata da questo browser.');
    const scale = Math.min(1, MAX_REC_SIDE / Math.max(this.gl.width, this.gl.height));
    // Even dimensions keep H.264 encoders happy.
    const w = Math.round((this.gl.width * scale) / 2) * 2;
    const h = Math.round((this.gl.height * scale) / 2) * 2;
    this.recCanvas = document.createElement('canvas');
    this.recCanvas.width = w;
    this.recCanvas.height = h;
    this.recCtx = this.recCanvas.getContext('2d');
    this.recCtx.fillRect(0, 0, w, h);
    const stream = this.recCanvas.captureStream(30);
    const opts = { videoBitsPerSecond: 8_000_000 };
    if (this.mime) opts.mimeType = this.mime;
    this.chunks = [];
    this.rec = new MediaRecorder(stream, opts);
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.startedAt = performance.now();
    this.rec.start(250);
  }

  /** Call once per rendered frame while recording. */
  frame(withOverlay) {
    if (!this.recording) return;
    this._compose(this.recCtx, this.recCanvas.width, this.recCanvas.height, withOverlay);
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec) return resolve(null);
      const rec = this.rec;
      rec.onstop = () => {
        const type = rec.mimeType || this.mime || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        this.rec = null;
        this.recCanvas = null;
        this.recCtx = null;
        resolve(blob);
      };
      try { rec.stop(); } catch { resolve(null); }
    });
  }
}
