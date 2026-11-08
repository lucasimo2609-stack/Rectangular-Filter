// Hand pose classification and the "fist → V" gesture sequence.
//
// A pose is computed per hand from the 21 MediaPipe landmarks using joint angles
// (how straight each finger is) and distances from the wrist, so it works whether
// the palm faces the camera or not. The thumb is ignored: in a fist and in a V it
// can be anywhere.

const FINGERS = {
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

// Landmarks are normalised to the image (x by width, y by height, z ~ width),
// so scale them to pixels to get isotropic distances.
function P(lm, w, h) { return [lm.x * w, lm.y * h, (lm.z || 0) * w]; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const cos = (a, b) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((len(a) * len(b)) || 1e-6);

/** Per-finger metrics: `straight` ~1 when extended, negative when folded back. */
export function fingerMetrics(hand, w, h) {
  const wrist = P(hand[0], w, h);
  const out = {};
  for (const [name, [mcp, pip, , tip]] of Object.entries(FINGERS)) {
    const M = P(hand[mcp], w, h);
    const Pp = P(hand[pip], w, h);
    const T = P(hand[tip], w, h);
    out[name] = {
      straight: cos(sub(Pp, M), sub(T, Pp)),
      reach: len(sub(T, wrist)) / (len(sub(Pp, wrist)) || 1e-6),
    };
  }
  return out;
}

/** Returns 'fist', 'v' or 'other'. */
export function classifyPose(hand, w, h) {
  if (!hand || hand.length < 21) return 'other';
  const f = fingerMetrics(hand, w, h);
  const extended = (m) => m.straight > 0.55 && m.reach > 1.08;
  const folded = (m) => m.straight < 0.25 || m.reach < 0.92;

  if (folded(f.index) && folded(f.middle) && folded(f.ring) && folded(f.pinky)) return 'fist';

  if (extended(f.index) && extended(f.middle) && folded(f.ring) && folded(f.pinky)) {
    // The two fingers must be spread apart (a "V"), not held together.
    const palm = len(sub(P(hand[9], w, h), P(hand[0], w, h))) || 1e-6;
    const spread = len(sub(P(hand[8], w, h), P(hand[12], w, h))) / palm;
    if (spread > 0.3) return 'v';
  }
  return 'other';
}

/**
 * Detects, per hand, a fist held for a moment followed by a V sign.
 * update() returns { triggered, armed, poses }.
 */
export class GestureSequence {
  constructor({ fistHold = 220, vHold = 180, window = 1600, cooldown = 1200, debounce = 70 } = {}) {
    this.opts = { fistHold, vHold, window, cooldown, debounce };
    this.hands = new Map();
    this.lastTrigger = -1e9;
  }

  reset() { this.hands.clear(); }

  update(hands, labels, w, h, now) {
    const { fistHold, vHold, window, cooldown, debounce } = this.opts;
    const poses = [];
    let triggered = false;
    let armed = false;
    const seen = new Set();

    hands.forEach((hand, i) => {
      let key = labels[i] || `#${i}`;
      if (seen.has(key)) key += `#${i}`;
      seen.add(key);

      let s = this.hands.get(key);
      if (!s) {
        s = { cand: 'other', candSince: now, pose: 'other', poseSince: now, fistAt: -1e9, fired: false, seen: now };
        this.hands.set(key, s);
      }
      s.seen = now;

      const raw = classifyPose(hand, w, h);
      if (raw !== s.cand) { s.cand = raw; s.candSince = now; }
      if (s.pose !== s.cand && now - s.candSince >= debounce) {
        s.pose = s.cand;
        s.poseSince = s.candSince;
        if (s.pose !== 'v') s.fired = false;
      }

      // A fist counts once it has been held long enough; remember when it was last valid.
      if (s.pose === 'fist' && now - s.poseSince >= fistHold) s.fistAt = now;
      if (now - s.fistAt <= window) armed = true;

      if (
        s.pose === 'v' && !s.fired &&
        now - s.poseSince >= vHold &&
        s.poseSince - s.fistAt <= window &&
        now - this.lastTrigger >= cooldown
      ) {
        s.fired = true;
        s.fistAt = -1e9;
        this.lastTrigger = now;
        triggered = true;
      }
      poses.push(s.pose);
    });

    for (const [key, s] of this.hands) if (now - s.seen > 1000) this.hands.delete(key);
    return { triggered, armed: armed && !triggered, poses };
  }
}
