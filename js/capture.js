// Photo snapshots of the composited output (WebGL canvas + hand overlay).

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class Capture {
  constructor(glCanvas, overlayCanvas) {
    this.gl = glCanvas;
    this.overlay = overlayCanvas;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Draws the current output (optionally with the hand overlay) on an internal canvas
   * and returns it. Must be called right after rendering, in the same task.
   */
  compose(withOverlay) {
    const c = this.canvas;
    if (c.width !== this.gl.width || c.height !== this.gl.height) {
      c.width = this.gl.width;
      c.height = this.gl.height;
    }
    this.ctx.drawImage(this.gl, 0, 0);
    if (withOverlay) this.ctx.drawImage(this.overlay, 0, 0);
    return c;
  }

  snapshot(withOverlay) {
    const c = this.compose(withOverlay);
    return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
  }
}
