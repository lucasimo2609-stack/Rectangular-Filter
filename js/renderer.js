import { FILTER_GLSL } from './filters.js';

const VERT = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uVideo;
uniform sampler2D uBg;
uniform vec2  uRes;      // drawing-buffer size in px
uniform vec4  uMap;      // video rect on the canvas: x, y, w, h (px, origin top-left)
uniform float uMirror;   // 1.0 = mirror horizontally (selfie view)
uniform vec2  uTexel;    // 1 / video size
uniform vec2  uA;        // polygon corners (px, origin top-left)
uniform vec2  uB;
uniform vec2  uC;
uniform vec2  uD;
uniform vec2  uCenter;
uniform float uAlpha;    // 0..1 visibility of the effect
uniform int   uFilter;
uniform float uTime;
uniform float uInvert;   // 1.0 = apply outside the polygon
uniform float uOutline;  // outline width in px, 0 = none
uniform float uFeather;  // edge softness in px
uniform float uHasBg;
uniform sampler2D uMask; // person segmentation (r: 0 = background, 1 = person)
uniform float uHasMask;
uniform float uVanish;   // 0 = you are visible, 1 = only the background is left

vec2 toUV(vec2 p) {
  vec2 uv = (p - uMap.xy) / uMap.zw;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  return uv;
}

${FILTER_GLSL}

vec3 bgAt(vec2 uv) { return texture2D(uBg, clamp(uv, 0.0, 1.0)).rgb; }

// How much a pixel belongs to you: the (dilated) segmentation mask, joined with
// the difference from the background plate (catches shadows, held objects and
// whatever the segmentation misses). Over-covering is harmless because those
// pixels get replaced by the real background anyway.
float personMask(vec2 uv) {
  float m = 0.0;
  if (uHasMask > 0.5) {
    vec2 r = uTexel * 14.0;
    m = texture2D(uMask, uv).r;
    m = max(m, texture2D(uMask, uv + vec2( r.x, 0.0)).r);
    m = max(m, texture2D(uMask, uv + vec2(-r.x, 0.0)).r);
    m = max(m, texture2D(uMask, uv + vec2(0.0,  r.y)).r);
    m = max(m, texture2D(uMask, uv + vec2(0.0, -r.y)).r);
    m = max(m, texture2D(uMask, uv + r * 0.7).r);
    m = max(m, texture2D(uMask, uv - r * 0.7).r);
    m = max(m, texture2D(uMask, uv + vec2(r.x, -r.y) * 0.7).r);
    m = max(m, texture2D(uMask, uv + vec2(-r.x, r.y) * 0.7).r);
    m = smoothstep(0.05, 0.3, m);
  }
  vec2 t = uTexel * 2.0;
  vec3 a = vid(uv) + vid(uv + vec2(t.x, 0.0)) + vid(uv - vec2(t.x, 0.0)) + vid(uv + vec2(0.0, t.y)) + vid(uv - vec2(0.0, t.y));
  vec3 b = bgAt(uv) + bgAt(uv + vec2(t.x, 0.0)) + bgAt(uv - vec2(t.x, 0.0)) + bgAt(uv + vec2(0.0, t.y)) + bgAt(uv - vec2(0.0, t.y));
  float d = length(a - b) / 5.0;
  return max(m, smoothstep(0.09, 0.2, d));
}

// One edge of Inigo Quilez's polygon SDF (even-odd rule, so self-crossing "bow ties" work too).
void polyEdge(vec2 p, vec2 vi, vec2 vj, inout float d, inout float s) {
  vec2 e = vj - vi;
  vec2 w = p - vi;
  vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
  d = min(d, dot(b, b));
  bvec3 cond = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
  if (all(cond) || all(not(cond))) s *= -1.0;
}

// Signed distance to the quad A-B-C-D: negative inside.
float sdQuad(vec2 p) {
  float d = dot(p - uA, p - uA);
  float s = 1.0;
  polyEdge(p, uA, uD, d, s);
  polyEdge(p, uB, uA, d, s);
  polyEdge(p, uC, uB, d, s);
  polyEdge(p, uD, uC, d, s);
  return s * sqrt(d);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = toUV(p);
  vec3 c = vid(uv);
  vec3 col = c;

  // "Vanish": you dissolve through a quick blur and only the background is left.
  if (uVanish > 0.001 && uHasBg > 0.5) {
    float m = personMask(uv);
    if (m > 0.001) {
      vec3 bg = bgAt(uv);
      vec3 ghost = bg;
      if (uVanish < 0.999) {
        float radius = 26.0 * smoothstep(0.0, 0.55, uVanish);
        ghost = mix(blurAt(uv, radius), bg, smoothstep(0.3, 1.0, uVanish));
      }
      col = mix(c, ghost, m);
    }
  }

  if (uAlpha > 0.001) {
    float sd = sdQuad(p);
    float f = uFeather + 0.75;
    float m = 1.0 - smoothstep(-f, f, sd);
    if (uInvert > 0.5) m = 1.0 - m;
    m *= uAlpha;
    if (m > 0.002) col = mix(c, applyFilter(p, uv, c), m);
    if (uOutline > 0.0) {
      float line = 1.0 - smoothstep(uOutline * 0.5 - 0.75, uOutline * 0.5 + 0.75, abs(sd));
      col = mix(col, vec3(1.0), line * uAlpha);
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader: ' + log);
  }
  return sh;
}

function makeTexture(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // 1x1 black placeholder so sampling is always valid.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  return t;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.bgSize = null; // [w, h] of the captured background, null if none
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.bgSize = null; this.hasMask = false; this._init(); });
    this._init();
  }

  _init() {
    const gl = this.canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL non disponibile su questo browser.');
    this.gl = gl;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      this.u[info.name] = gl.getUniformLocation(prog, info.name);
    }

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.texVideo = makeTexture(gl);
    this.texBg = makeTexture(gl);
    this.texMask = makeTexture(gl);
    this.hasMask = false;
    gl.uniform1i(this.u.uVideo, 0);
    gl.uniform1i(this.u.uBg, 1);
    gl.uniform1i(this.u.uMask, 2);
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Copies the current video frame into the background texture. */
  captureBackground(video) {
    if (this.lost) return false;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texBg);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    this.bgSize = [video.videoWidth, video.videoHeight];
    return true;
  }

  clearBackground() { this.bgSize = null; }

  /** Uploads a person mask (Uint8, 1 byte per pixel, same framing as the video). */
  updateMask(mask) {
    if (this.lost) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mask.width, mask.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, mask.data);
    this.hasMask = true;
  }

  clearMask() { this.hasMask = false; }

  hasBackgroundFor(video) {
    return !!this.bgSize && this.bgSize[0] === video.videoWidth && this.bgSize[1] === video.videoHeight;
  }

  render(s) {
    if (this.lost) return;
    const gl = this.gl;
    const u = this.u;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texVideo);
    if (s.uploadVideo) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, s.video);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texBg);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);

    const [A, B, C, D] = s.corners;
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform4f(u.uMap, s.map.x, s.map.y, s.map.w, s.map.h);
    gl.uniform1f(u.uMirror, s.mirror ? 1 : 0);
    gl.uniform2f(u.uTexel, 1 / Math.max(1, s.video.videoWidth), 1 / Math.max(1, s.video.videoHeight));
    gl.uniform2f(u.uA, A[0], A[1]);
    gl.uniform2f(u.uB, B[0], B[1]);
    gl.uniform2f(u.uC, C[0], C[1]);
    gl.uniform2f(u.uD, D[0], D[1]);
    gl.uniform2f(u.uCenter, (A[0] + B[0] + C[0] + D[0]) / 4, (A[1] + B[1] + C[1] + D[1]) / 4);
    gl.uniform1f(u.uAlpha, s.alpha);
    gl.uniform1i(u.uFilter, s.filter);
    gl.uniform1f(u.uTime, s.time);
    gl.uniform1f(u.uInvert, s.invert ? 1 : 0);
    gl.uniform1f(u.uOutline, s.outline);
    gl.uniform1f(u.uFeather, s.feather);
    gl.uniform1f(u.uHasBg, this.hasBackgroundFor(s.video) ? 1 : 0);
    gl.uniform1f(u.uHasMask, this.hasMask ? 1 : 0);
    gl.uniform1f(u.uVanish, s.vanish || 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
