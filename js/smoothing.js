// One Euro Filter (Casiez et al. 2012): low jitter when still, low lag when moving fast.
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
}

const alpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.01, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.prev = null;
  }

  filter(value, dt) {
    if (this.prev === null || dt <= 0) {
      this.prev = value;
      this.x.y = value;
      this.dx.y = 0;
      return value;
    }
    const d = (value - this.prev) / dt;
    this.prev = value;
    const ed = this.dx.filter(d, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.filter(value, alpha(cutoff, dt));
  }
}

/** Smooths N 2D points with independent One Euro filters per coordinate. */
export class PointSmoother {
  constructor(n) {
    this.filters = Array.from({ length: n * 2 }, () => new OneEuro());
  }

  configure(strength) {
    // strength 0 (raw) … 10 (very smooth). Cutoff in Hz, beta in 1/px.
    const minCutoff = strength <= 0 ? 1000 : 6 / (1 + strength * 0.9);
    const beta = 0.004 + (10 - strength) * 0.0012;
    for (const f of this.filters) { f.minCutoff = minCutoff; f.beta = beta; }
  }

  reset() { for (const f of this.filters) f.reset(); }

  filter(points, dt) {
    return points.map((p, i) => [
      this.filters[i * 2].filter(p[0], dt),
      this.filters[i * 2 + 1].filter(p[1], dt),
    ]);
  }
}
