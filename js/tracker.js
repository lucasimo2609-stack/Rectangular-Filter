// Thin wrapper around MediaPipe Tasks Vision HandLandmarker.
// Library, WASM and model are loaded from public CDNs the first time the app starts.

export const MEDIAPIPE_VERSION = '0.10.21';
export const MEDIAPIPE_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
export const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
export const THUMB_TIP = 4;
export const INDEX_TIP = 8;

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.delegate = null;
    this.vision = null;
    this.lib = null;
    this.model = null;
    this.lastTs = -1;
  }

  /**
   * @param {'auto'|'GPU'|'CPU'} engine  "auto" tries the GPU and falls back to the CPU.
   * "?cpu" in the page URL always forces the CPU.
   */
  async init(engine = 'auto', onProgress = () => {}) {
    onProgress('Carico il riconoscimento mani…');
    this.lib = await import(`${MEDIAPIPE_BASE}/vision_bundle.mjs`);
    this.vision = await this.lib.FilesetResolver.forVisionTasks(`${MEDIAPIPE_BASE}/wasm`);
    onProgress('Carico il modello…');
    const res = await fetch(HAND_MODEL_URL);
    if (!res.ok) throw new Error(`Download del modello fallito (${res.status})`);
    this.model = new Uint8Array(await res.arrayBuffer());
    await this.setEngine(engine);
  }

  async setEngine(engine) {
    if (new URLSearchParams(location.search).has('cpu')) engine = 'CPU';
    if (engine === 'CPU') return this._create('CPU');
    try {
      await this._create('GPU');
    } catch (err) {
      if (engine === 'GPU') throw err;
      console.warn('GPU delegate non disponibile, uso la CPU', err);
      await this._create('CPU');
    }
  }

  async _create(delegate) {
    const old = this.landmarker;
    this.landmarker = null;
    if (old) { try { old.close(); } catch { /* ignore */ } }
    this.landmarker = await this.lib.HandLandmarker.createFromOptions(this.vision, {
      baseOptions: { modelAssetBuffer: new Uint8Array(this.model), delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.delegate = delegate;
    this.lastTs = -1;
  }

  /** Returns an array of hands, each an array of 21 {x, y, z} normalised landmarks. */
  detect(video, nowMs) {
    if (!this.landmarker) return [];
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(nowMs, this.lastTs + 1);
    this.lastTs = ts;
    try {
      const res = this.landmarker.detectForVideo(video, ts);
      return res.landmarks || [];
    } catch (err) {
      if (this.delegate === 'GPU' && !this._fallingBack) {
        console.warn('Errore con GPU delegate, passo alla CPU', err);
        this._fallingBack = true;
        this._create('CPU').finally(() => { this._fallingBack = false; });
        return [];
      }
      throw err;
    }
  }
}
