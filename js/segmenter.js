// Person segmentation (MediaPipe Image Segmenter, selfie model) used by the
// "vanish" effect to know which pixels belong to you.

export const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

export class PersonSegmenter {
  constructor() {
    this.segmenter = null;
    this.model = null;
    this.lastTs = -1;
    this.buf = null;
    this.width = 0;
    this.height = 0;
  }

  /** `lib` and `vision` come from an already initialised HandTracker. */
  async init(lib, vision, delegate) {
    if (!this.model) {
      const res = await fetch(SEGMENTER_MODEL_URL);
      if (!res.ok) throw new Error(`Download del modello di segmentazione fallito (${res.status})`);
      this.model = new Uint8Array(await res.arrayBuffer());
    }
    const old = this.segmenter;
    this.segmenter = null;
    if (old) { try { old.close(); } catch { /* ignore */ } }
    const create = (d) => lib.ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: new Uint8Array(this.model), delegate: d },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    try {
      this.segmenter = await create(delegate);
    } catch (err) {
      if (delegate !== 'GPU') throw err;
      this.segmenter = await create('CPU');
    }
    this.lastTs = -1;
    this.buf = null;
  }

  /** Forget the temporal history (call when the effect starts again). */
  resetHistory() { if (this.buf) this.buf.fill(0); }

  get ready() { return !!this.segmenter; }

  /**
   * Segments a video frame. Returns { data: Uint8Array (0 = background, 255 = person), width, height }
   * or null. The returned buffer is reused between calls.
   */
  segment(video, nowMs) {
    if (!this.segmenter) return null;
    const ts = Math.max(nowMs, this.lastTs + 1);
    this.lastTs = ts;
    let out = null;
    this.segmenter.segmentForVideo(video, ts, (result) => {
      const mask = result.confidenceMasks && result.confidenceMasks[0];
      if (!mask) return;
      const src = mask.getAsFloat32Array();
      const n = mask.width * mask.height;
      if (!this.buf || this.buf.length !== n) this.buf = new Uint8Array(n);
      const buf = this.buf;
      // Short temporal hold: a pixel you just left stays covered for a few frames,
      // which removes flicker at the edges. Covering a bit too much is invisible
      // because those pixels show the real background anyway.
      for (let i = 0; i < n; i++) {
        const v = src[i];
        const cur = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0;
        const held = (buf[i] * 0.8) | 0;
        buf[i] = cur > held ? cur : held;
      }
      this.width = mask.width;
      this.height = mask.height;
      out = { data: buf, width: mask.width, height: mask.height };
    });
    return out;
  }
}
