// Filter catalogue. `id` is the integer passed to the fragment shader (see renderer.js).
// `swatch` is only a CSS preview for the filter chip.
export const FILTERS = [
  { id: 0, key: 'acid', name: 'Acido', swatch: 'conic-gradient(from 30deg, #ff2d95, #ffe600, #39ff6a, #00c8ff, #7a3cff, #ff2d95)' },
  { id: 1, key: 'bw', name: 'Bianco e nero', swatch: 'linear-gradient(135deg, #fff 0%, #777 50%, #111 100%)' },
  { id: 2, key: 'invisible', name: 'Invisibile', swatch: 'repeating-conic-gradient(#3a3a44 0 25%, #1b1b22 0 50%) 0 0 / 14px 14px', needsBackground: true },
  { id: 3, key: 'thermal', name: 'Termico', swatch: 'linear-gradient(135deg, #0b0030, #7a00c8, #ff2d55, #ffb300, #fff8b0)' },
  { id: 4, key: 'negative', name: 'Negativo', swatch: 'linear-gradient(135deg, #00e5ff, #ff1a75)' },
  { id: 5, key: 'pixel', name: 'Pixel', swatch: 'repeating-conic-gradient(#39ff6a 0 25%, #0a7 0 50%) 0 0 / 12px 12px' },
  { id: 6, key: 'neon', name: 'Neon', swatch: 'radial-gradient(circle at 50% 50%, #000 35%, #00f0ff 36%, #000 44%, #ff2dd0 46%, #000 54%)' },
  { id: 7, key: 'glitch', name: 'Glitch', swatch: 'linear-gradient(90deg, #f00 0 33%, #0f0 33% 66%, #00f 66%)' },
  { id: 8, key: 'comic', name: 'Fumetto', swatch: 'radial-gradient(circle, #111 18%, transparent 20%) 0 0 / 8px 8px, linear-gradient(135deg, #ffd400, #ff4d4d)' },
  { id: 9, key: 'blur', name: 'Sfocato', swatch: 'radial-gradient(circle at 40% 40%, #9ad 0%, #546 60%, #223 100%)' },
  { id: 10, key: 'xray', name: 'Raggi X', swatch: 'linear-gradient(135deg, #001018, #0a4d68, #b8f3ff)' },
  { id: 11, key: 'kaleido', name: 'Caleidoscopio', swatch: 'conic-gradient(#ff2d95 0 12.5%, #ffe600 0 25%, #ff2d95 0 37.5%, #ffe600 0 50%, #ff2d95 0 62.5%, #ffe600 0 75%, #ff2d95 0 87.5%, #ffe600 0)' },
];

// GLSL (ES 1.0) for all filters. Every filter receives:
//   p  – fragment position in canvas pixels (origin top-left)
//   uv – matching video texture coordinate
//   c  – unfiltered video colour at uv
export const FILTER_GLSL = /* glsl */ `
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 vid(vec2 uv) { return texture2D(uVideo, clamp(uv, 0.0, 1.0)).rgb; }

// Sobel gradient of luminance. Returns (gx, gy).
vec2 sobel(vec2 uv, float r) {
  vec2 t = uTexel * r;
  float tl = luma(vid(uv + vec2(-t.x, -t.y)));
  float tc = luma(vid(uv + vec2( 0.0, -t.y)));
  float tr = luma(vid(uv + vec2( t.x, -t.y)));
  float ml = luma(vid(uv + vec2(-t.x,  0.0)));
  float mr = luma(vid(uv + vec2( t.x,  0.0)));
  float bl = luma(vid(uv + vec2(-t.x,  t.y)));
  float bc = luma(vid(uv + vec2( 0.0,  t.y)));
  float br = luma(vid(uv + vec2( t.x,  t.y)));
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  return vec2(gx, gy);
}

vec3 thermalRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.04, 0.0, 0.19);
  vec3 c1 = vec3(0.45, 0.0, 0.78);
  vec3 c2 = vec3(1.0, 0.16, 0.33);
  vec3 c3 = vec3(1.0, 0.70, 0.0);
  vec3 c4 = vec3(1.0, 0.98, 0.72);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5)  return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

vec3 blurAt(vec2 uv, float radius) {
  vec3 acc = vid(uv);
  float w = 1.0;
  // 24-tap golden-angle spiral
  for (int i = 1; i < 25; i++) {
    float fi = float(i);
    float r = sqrt(fi / 24.0) * radius;
    float a = fi * 2.39996323;
    acc += vid(uv + vec2(cos(a), sin(a)) * r * uTexel);
    w += 1.0;
  }
  return acc / w;
}

vec3 applyFilter(vec2 p, vec2 uv, vec3 c) {
  float scale = uRes.y / 720.0; // keeps pixel-based effects consistent across resolutions

  if (uFilter == 0) {
    // Acid / psychedelic: luminance + edges mapped onto a cycling rainbow, with grain.
    float l = luma(c);
    vec2 g = sobel(uv, 1.5);
    float e = length(g);
    float n = hash(p * 0.5 + fract(uTime) * 100.0);
    float h = fract(l * 2.6 + e * 1.4 + n * 0.10 - uTime * 0.12);
    vec3 col = hsv2rgb(vec3(h, 0.85, 0.75 + 0.25 * smoothstep(0.1, 0.9, l)));
    col = mix(col, vec3(1.0, 0.1, 0.55), smoothstep(0.5, 1.2, e) * 0.6);
    return col;
  }
  if (uFilter == 1) {
    // Black & white with a little contrast.
    float l = luma(c);
    l = clamp((l - 0.5) * 1.15 + 0.5, 0.0, 1.0);
    return vec3(l);
  }
  if (uFilter == 2) {
    // Invisible: show the captured background plate.
    if (uHasBg > 0.5) return texture2D(uBg, clamp(uv, 0.0, 1.0)).rgb;
    float stripes = step(0.5, fract((p.x + p.y) / (24.0 * scale)));
    return mix(c * 0.35, vec3(luma(c)), 0.5) + stripes * 0.06;
  }
  if (uFilter == 3) {
    // Thermal camera look.
    float l = luma(blurAt(uv, 3.0));
    return thermalRamp(pow(l, 0.85) * 1.05);
  }
  if (uFilter == 4) {
    return 1.0 - c;
  }
  if (uFilter == 5) {
    // Pixelate in screen space so the blocks are square.
    float bs = 22.0 * scale;
    vec2 q = (floor(p / bs) + 0.5) * bs;
    vec3 col = vid(toUV(q));
    col = floor(col * 6.0 + 0.5) / 6.0;
    vec2 f = fract(p / bs);
    float grid = step(0.08, f.x) * step(0.08, f.y);
    return col * mix(0.75, 1.0, grid);
  }
  if (uFilter == 6) {
    // Neon edges on black, hue follows edge direction.
    vec2 g = sobel(uv, 1.0);
    float e = smoothstep(0.08, 0.5, length(g));
    float h = atan(g.y, g.x) / 6.2831853 + uTime * 0.08;
    return hsv2rgb(vec3(h, 0.9, 1.0)) * e * 1.6;
  }
  if (uFilter == 7) {
    // RGB split glitch with horizontal tearing and scanlines.
    float band = floor(p.y / (18.0 * scale));
    float t = floor(uTime * 12.0);
    float tear = (hash(vec2(band, t)) - 0.5) * step(0.82, hash(vec2(t, band * 0.37))) * 0.08;
    float off = (0.006 + 0.004 * sin(uTime * 7.0)) ;
    vec2 u2 = uv + vec2(tear, 0.0);
    vec3 col = vec3(vid(u2 + vec2(off, 0.0)).r, vid(u2).g, vid(u2 - vec2(off, 0.0)).b);
    col *= 0.85 + 0.15 * step(0.5, fract(p.y / (3.0 * scale)));
    return col;
  }
  if (uFilter == 8) {
    // Comic: posterised colour, ink outlines and halftone dots in the shadows.
    vec3 s = blurAt(uv, 2.0);
    vec3 col = floor(s * 4.0 + 0.5) / 4.0;
    col = mix(vec3(luma(col)), col, 1.5);
    float e = smoothstep(0.25, 0.45, length(sobel(uv, 1.5)));
    float cell = 7.0 * scale;
    vec2 f = fract(p / cell) - 0.5;
    float dotR = (1.0 - luma(s)) * 0.55;
    float dots = 1.0 - smoothstep(dotR - 0.06, dotR + 0.06, length(f));
    col *= 1.0 - dots * 0.35;
    return clamp(col, 0.0, 1.0) * (1.0 - e);
  }
  if (uFilter == 9) {
    // Strong blur (radius in video texels).
    return blurAt(uv, 14.0);
  }
  if (uFilter == 10) {
    // X-ray: inverted luminance, cyan tint, glowing edges.
    float l = 1.0 - luma(c);
    float e = smoothstep(0.1, 0.6, length(sobel(uv, 1.0)));
    vec3 col = vec3(0.05, 0.25, 0.35) + vec3(0.55, 0.9, 1.0) * pow(l, 1.6);
    return col + e * vec3(0.4, 0.9, 1.0) * 0.6;
  }
  if (uFilter == 11) {
    // Kaleidoscope around the rectangle centre.
    vec2 d = p - uCenter;
    float r = length(d);
    float a = atan(d.y, d.x) + uTime * 0.25;
    float seg = 6.2831853 / 8.0;
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    vec2 q = uCenter + vec2(cos(a), sin(a)) * r;
    return vid(toUV(q));
  }
  return c;
}
`;
