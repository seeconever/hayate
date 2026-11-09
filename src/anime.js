// =====================================================================================================
// ANIME LOOK KIT — "Fable 5.5 Anime Lab" (three 0.160, 'three' + 'three/addons/' from the importmap)
// Painterly Ghibli / Shinkai look: cel-shaded Clawd with ink lines, gouache backgrounds (Kuwahara paint pass
// masked by alpha), practical glows (core + halo + glow sprite + cel spill), god-ray shafts + screen-space rays,
// bloom + halation + grain + paper + vignette + chromatic softness, 24 fps "on twos", brush end card.
// This copy carries the Ame extensions: wet vinyl, world-anchored paint, scene capture, frozen-rain clock, lens drops (section 13).
//
// ALPHA = PAINT MASK. Every kit material writes alpha: 1 = painted background (gets the Kuwahara gouache pass),
// 0 = clean cel layer (Clawd, outlines, glow cores, rain, drops, lettering). FX blends never raise the mask.
// Colours: THREE.Color hex = sRGB, converted to linear by three; the post chain does its own tone curve + sRGB.
// =====================================================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const V3 = THREE.Vector3, C = (c) => (c instanceof THREE.Color ? c.clone() : new THREE.Color(c));
const MAXP = 8;
export const KIT_VERSION = 'anime-kit 1.0 (2026-11-04)';

// ---------- time ----------------------------------------------------------------------------------
// Character animation "on twos": 24 fps film, drawings held 2 frames = 12 drawings/s. Camera + FX stay on ones.
export const onTwos = (t, fps = 24, hold = 2) => Math.floor(t * fps / hold + 1e-6) * hold / fps;

// ---------- seeded random ---------------------------------------------------------------------------
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// ---------- GLSL chunks ---------------------------------------------------------------------------
export const GLSL_NOISE = `
float h13(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float n2(vec2 x){ vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(h12(i), h12(i + vec2(1,0)), f.x), mix(h12(i + vec2(0,1)), h12(i + vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
`;
const GLSL_FOG = `
uniform vec3 uFogCol; uniform float uFogNear, uFogFar, uFogH0, uFogHK, uFogMax;
vec3 applyFog(vec3 c, vec3 w){ float d = length(w - cameraPosition); float f = smoothstep(uFogNear, uFogFar, d);
  if (uFogHK > 0.0) f *= exp(-max(w.y - uFogH0, 0.0) * uFogHK);
  return mix(c, uFogCol, clamp(f, 0.0, uFogMax)); }
`;

// ---------- blending helpers (keep the paint mask in alpha honest) -----------------------------------
// additive light that leaves the destination alpha (paint mask) untouched
export function addBlend(m) { m.transparent = true; m.depthWrite = false; m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; return m; }
// over-blend whose coverage CUTS the paint mask (rain, drops, stars stay crisp under the Kuwahara pass)
// mode 'premult': colour = src.rgb + dst (shader outputs premultiplied light), alpha = coverage that cuts the mask fully
export function cutBlend(m, additive = false) { m.transparent = true; m.depthWrite = false; m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
  m.blendSrc = additive === 'premult' ? THREE.OneFactor : THREE.SrcAlphaFactor; m.blendDst = additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor; return m; }
// normal "over" blend that leaves the destination alpha (paint mask) untouched (painted cards over a painted sky)
export function overBlend(m) { m.transparent = true; m.depthWrite = false; m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; return m; }
// built-in material -> writes alpha = mask (and optional colour multiplier uniform uTint)
export function maskMat(m, mask = 0, tint = null) {
  m.onBeforeCompile = (sh) => { sh.uniforms.uMaskA = { value: mask }; if (tint) sh.uniforms.uTint = tint;
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `uniform float uMaskA;${tint ? ' uniform vec3 uTint;' : ''}\nvoid main() {`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${tint ? 'gl_FragColor.rgb *= uTint;' : ''} gl_FragColor.a = uMaskA;`); };
  m.customProgramCacheKey = () => 'mask' + mask + (tint ? 't' : ''); return m;
}

// ---------- canvas textures -------------------------------------------------------------------------
export function canvasTex(w, h, draw, { srgb = true, repeat = false, mips = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.userData.canvas = c; return t;
}
let _GLOWTEX = null;
export function glowTexture() { return _GLOWTEX ||= canvasTex(256, 256, (c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, 'rgba(255,255,255,0.6)'); g.addColorStop(0.35, 'rgba(255,255,255,0.16)'); g.addColorStop(0.7, 'rgba(255,255,255,0.03)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, w, h); }, { srgb: false }); }

// =====================================================================================================
// 1. LIGHT RIG — one per scene; every toon / paint material shares its uniforms (key, rim, ambient, fog, 8 spill points)
// =====================================================================================================
export function createRig() {
  const u = {
    uKeyDir: { value: new V3(-0.5, 0.75, 0.45).normalize() }, uKeyCol: { value: new THREE.Color(1, 0.95, 0.85) },
    uSky: { value: new THREE.Color(0.32, 0.30, 0.34) }, uGround: { value: new THREE.Color(0.20, 0.16, 0.15) },
    uRimDir: { value: new V3(0.6, 0.3, -0.75).normalize() }, uRimCol: { value: new THREE.Color(0, 0, 0) },
    uPPos: { value: Array.from({ length: MAXP }, () => new V3()) }, uPCol: { value: Array.from({ length: MAXP }, () => new THREE.Color(0, 0, 0)) },
    uPRange: { value: new Array(MAXP).fill(1) }, uPN: { value: 0 },
    uFogCol: { value: new THREE.Color(0.5, 0.5, 0.6) }, uFogNear: { value: 1e5 }, uFogFar: { value: 2e5 }, uFogH0: { value: 0 }, uFogHK: { value: 0 }, uFogMax: { value: 1 },
    uTime: { value: 0 },
  };
  const rig = {
    u, points: [],
    key(dir, color, k = 1) { u.uKeyDir.value.copy(dir).normalize(); u.uKeyCol.value.copy(C(color)).multiplyScalar(k); return rig; },
    rim(dir, color, k = 1) { u.uRimDir.value.copy(dir).normalize(); u.uRimCol.value.copy(C(color)).multiplyScalar(k); return rig; },
    amb(sky, ground, k = 1) { u.uSky.value.copy(C(sky)).multiplyScalar(k); u.uGround.value.copy(C(ground)).multiplyScalar(k); return rig; },
    fog(color, near, far, { h0 = 0, hk = 0, max = 1 } = {}) { u.uFogCol.value.copy(C(color)); u.uFogNear.value = near; u.uFogFar.value = far; u.uFogH0.value = h0; u.uFogHK.value = hk; u.uFogMax.value = max; return rig; },
    // point = { pos: Vector3 | Object3D, offset?: Vector3, color, intensity, range }  (cel spill light, max 8 per scene)
    addPoint(p) { p.color = C(p.color ?? 0xffffff); p.intensity ??= 1; p.range ??= 5; rig.points.push(p); return p; },
    update(time = 0) {
      u.uTime.value = time; const _w = new V3();
      // with rig.focus set (hero position), the 8 slots go to the points that matter most there: intensity x range / (range + distance)
      for (const p of rig.points) { if (p.pos.isObject3D) p.pos.getWorldPosition(_w); else _w.copy(p.pos); p.score = rig.focus ? p.intensity * p.range / (p.range + _w.distanceTo(rig.focus)) : p.intensity; }
      const pts = rig.points.filter(p => p.intensity > 0).sort((a, b) => b.score - a.score).slice(0, MAXP);
      pts.forEach((p, i) => { if (p.pos.isObject3D) p.pos.getWorldPosition(u.uPPos.value[i]); else u.uPPos.value[i].copy(p.pos); if (p.offset) u.uPPos.value[i].add(p.offset);
        u.uPCol.value[i].copy(p.color).multiplyScalar(p.intensity); u.uPRange.value[i] = p.range; });
      u.uPN.value = pts.length;
    },
    // CPU estimate of the light reaching a point with normal n (used to tint the flat face parts)
    lightAt(pos, n) {
      const amb = u.uSky.value.clone().lerp(u.uGround.value, 0.5 - 0.5 * n.y);
      const c = amb.clone().lerp(u.uKeyCol.value.clone().add(amb.clone().multiplyScalar(0.25)),THREE.MathUtils.smoothstep(n.dot(u.uKeyDir.value), -0.05, 0.05));
      for (let i = 0; i < u.uPN.value; i++) { const L = u.uPPos.value[i].clone().sub(pos), d = L.length(); L.divideScalar(Math.max(d, 1e-4));
        const a = Math.max(0, 1 - d / u.uPRange.value[i]) ** 2 * THREE.MathUtils.smoothstep(n.dot(L), -0.05, 0.05); c.add(u.uPCol.value[i].clone().multiplyScalar(a)); }
      return c;
    },
  };
  return rig;
}

// =====================================================================================================
// 2. TOON / PAINT MATERIAL — 3 tone bands (shade / light / highlight), brush-broken terminator, hemisphere ambient,
//    shaped specular (bevels only), anime rim band, cel spill from rig points, self-glow, fog, alpha = paint mask.
// =====================================================================================================
const TOON_VS = `
varying vec3 vN, vW, vO, vIC, vON; varying vec2 vUv;
void main(){
  vec4 p = vec4(position, 1.0); vec3 n = normal; vON = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vIC = instanceColor;
  #else
    vIC = vec3(1.0);
  #endif
  vec4 w = modelMatrix * p; vW = w.xyz; vO = p.xyz; vUv = uv;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * n);
  gl_Position = projectionMatrix * viewMatrix * w; }`;
const TOON_FS = `
${GLSL_NOISE}
${GLSL_FOG}
uniform vec3 uBase, uShade, uHi, uKeyDir, uKeyCol, uSky, uGround, uRimDir, uRimCol, uFill, uGlowCol, uEmis;
uniform float uTerm, uSoft, uHiT, uHiAmt, uBrush, uBrushF, uSpec, uSpecThr, uRimW, uRimI, uGlow, uMask, uAmbK, uKeyK, uPtK, uFlatSpec, uSkyK, uAmbLit, uPig, uPigF, uLock, uTrans, uBackK;
uniform vec3 uPPos[${MAXP}]; uniform vec3 uPCol[${MAXP}]; uniform float uPRange[${MAXP}]; uniform int uPN;
#ifdef USE_MAP
uniform sampler2D map;
#endif
#ifdef USE_EMAP
uniform sampler2D emap;
#endif
#ifdef WET
uniform float uWet, uWetScale, uWetDen; uniform vec4 uWetFace;
#endif
varying vec3 vN, vW, vO, vIC, vON; varying vec2 vUv;
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vW);
  float br = (n3(vO * uBrushF) - 0.5) * uBrush + (n3(vO * uBrushF * 4.3 + 7.1) - 0.5) * uBrush * 0.6;
  vec3 base = uBase * vIC, shade = uShade * vIC, hiC = uHi * vIC;
  #ifdef USE_MAP
    vec4 tx = texture2D(map, vUv); base *= tx.rgb; shade *= tx.rgb; hiC *= tx.rgb;
  #endif
  float nl = dot(N, uKeyDir) + br;
  float lit = smoothstep(uTerm - uSoft, uTerm + uSoft, nl);
  // lit tone = base x key colour, shadow tone = shade x ambient (both ~1.0 under neutral light = the exact palette)
  vec3 amb = (mix(uGround, uSky, N.y * 0.5 + 0.5) * uAmbK + uFill);
  vec3 keyL = uKeyCol * uKeyK + amb * uAmbLit;
  vec3 col = mix(shade * amb, base * keyL, lit);
  float hb = smoothstep(uHiT - uSoft, uHiT + uSoft, nl) * lit;
  col = mix(col, hiC * keyL, hb * uHiAmt);
  if (!gl_FrontFacing) col *= uBackK;   // film 27: darker cel band on undersides (leaf)
  // shaped specular: hard-edged highlight only where the surface curves (bevels), not on flat faces
  vec3 H = normalize(uKeyDir + V); float sp = dot(N, H);
  float curv = clamp(length(fwidth(N)) / max(length(fwidth(vW)), 1e-4) * 0.2, 0.0, 1.0);
  float sm = smoothstep(uSpecThr, uSpecThr + 0.004, sp + br * 0.01) * mix(1.0, curv, uFlatSpec);
  col += uKeyCol * uKeyK * sm * uSpec;
  for (int i = 0; i < ${MAXP}; i++){ if (i >= uPN) break;
    vec3 L = uPPos[i] - vW; float d = length(L); L /= max(d, 1e-4);
    float a = clamp(1.0 - d / uPRange[i], 0.0, 1.0); a *= a;
    float b = smoothstep(-0.04, 0.06, dot(N, L) + br * 0.5);
    // film 27: cel-stepped spill (two hard bands) instead of a smooth falloff -> no 'plastic' gradients
    float ab = uMask < 0.5 ? smoothstep(0.08, 0.11, a + br * 0.05) * 0.2 + smoothstep(0.36, 0.39, a + br * 0.05) * 0.35 : a;   // characters / props banded, painted walls smooth
    col += mix(base, vec3(dot(base, vec3(0.333))), 0.35) * uPCol[i] * ab * b * uPtK;
    col += base * 1.4 * uPCol[i] * a * smoothstep(0.0, 0.35, -dot(N, L)) * uTrans; }   // back-lit translucency (leaves, paper)
  col += base * 1.4 * uKeyCol * uKeyK * smoothstep(0.0, 0.35, -dot(N, uKeyDir)) * uTrans;
  // palette lock (characters): under coloured light keep the model-sheet hue, let only the value follow the light
  vec3 tone = mix(mix(shade, base, lit), hiC, hb * uHiAmt);
  float lc = dot(col, vec3(0.2126, 0.7152, 0.0722)), lt = max(dot(tone, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  col = mix(col, tone * (lc / lt), uLock);
  float fr = 1.0 - clamp(dot(N, V), 0.0, 1.0);
  float rim = smoothstep(uRimW - 0.04, uRimW + 0.04, fr + br * 0.3) * smoothstep(0.0, 0.25, dot(N, uRimDir));
  col += uRimCol * rim * uRimI;
  #ifdef WET
    // film 27: wet vinyl (anime). Water beads on the face planes (object space, face plate kept clear) with a crisp white
    // catchlight, a light-gathering bottom crescent and a thin dark edge; plus 2-3 slanted white highlight strokes in the
    // key-light zone. uWet 0..1 fades it in.
    if (uWet > 0.001) {
      col *= 1.0 - 0.07 * uWet;
      vec3 aN = abs(vON); vec2 fc;
      if (aN.y > aN.x && aN.y > aN.z) fc = vO.xz; else if (aN.x > aN.z) fc = vO.zy; else fc = vO.xy;
      vec2 g = fc * uWetScale, gi = floor(g), gf = fract(g) - 0.5;
      float hh = h12(gi + 7.3 + floor(aN.x * 2.0) * 13.0), rs = 0.20 + 0.17 * h12(gi + 9.9);
      vec2 jo = vec2(h12(gi + 1.1), h12(gi + 4.7)) - 0.5;
      vec2 dq = (gf - jo * 0.35) / rs; dq.y *= 0.82 + 0.1 * h12(gi + 2.2);
      float rr = length(dq);
      float onFace = (vON.z > 0.6 && abs(vO.x - uWetFace.x) < uWetFace.z && abs(vO.y - uWetFace.y) < uWetFace.w) ? 0.0 : 1.0;
      float bead = step(1.0 - uWetDen * uWet, hh) * onFace;
      float inB = (1.0 - smoothstep(0.9, 1.0, rr)) * bead;
      vec3 bc = col * 0.80 + col * 0.55 * smoothstep(0.25, 0.9, -dq.y / max(rr, 1e-3)) * smoothstep(0.35, 0.85, rr);
      bc *= 1.0 - 0.45 * smoothstep(0.72, 0.95, rr) * smoothstep(-0.2, 0.6, -dq.y);
      float hl = 1.0 - smoothstep(0.17, 0.22, length(dq - vec2(-0.34, 0.36)));
      bc = mix(bc, vec3(1.15, 1.12, 1.08), hl);
      col = mix(col, bc, inB);
      // anime wet highlights: a dashed white line along the lit top-front bevel + two short slanted dashes in the
      // upper corner of the front face on the key side (object space, so they ride with the body)
      float sc = uWetFace.z / 0.37;
      float curvW = clamp(length(fwidth(N)) / max(length(fwidth(vW)), 1e-4) * 0.2, 0.0, 1.0);
      float side = sign(-uKeyDir.x + 1e-3);
      float bev = smoothstep(0.6, 0.8, curvW) * smoothstep(0.55, 0.65, vON.y) * smoothstep(0.3, 0.45, vON.z);
      float dash = smoothstep(0.6, 0.5, fract(vO.x / sc * 3.6 + 0.15)) * smoothstep(0.3 * sc, -0.2 * sc, vO.x * side);
      vec2 fp = (vO.xy - uWetFace.xy) / sc; fp.x *= side;
      vec2 c0 = fp - vec2(-0.355, 0.2); float dl = dot(c0, vec2(0.7071, -0.7071)), al = dot(c0, vec2(0.7071, 0.7071));
      float d1 = smoothstep(0.019, 0.011, abs(dl)) * smoothstep(0.1, 0.07, abs(al));
      float d2 = smoothstep(0.014, 0.008, abs(dl + 0.05)) * smoothstep(0.05, 0.03, abs(al + 0.015));
      float strokes = bev * dash + step(0.6, vON.z) * (d1 + d2);
      col = mix(col, vec3(1.05, 1.03, 1.0), clamp(strokes, 0.0, 1.0) * uWet * 0.6);
    }
  #endif
  #ifdef GLOW
    // self-glow: the body becomes an amber lamp but keeps a trace of its cel bands; hottest where it faces the lens.
    // Stays saturated through the tone knee (R ~ 1.5, G ~ 0.5) instead of clipping to white; bloom does the rest.
    float g = clamp(uGlow, 0.0, 2.5);
    vec3 gt = uGlowCol * (0.8 + 0.45 * (1.0 - fr) + 0.12 * n3(vO * 7.0));
    col = mix(col, gt * (0.65 + 0.35 * min(g, 1.5)) + col * 0.25, clamp(g, 0.0, 1.0)) + uGlowCol * max(g - 1.0, 0.0) * 0.45 * (1.0 - fr);
  #endif
  col *= 1.0 + (fbm3(vO * uPigF + 3.7) - 0.5) * uPig;   // gouache pigment variation (backgrounds)
  #ifdef USE_EMAP
    col += texture2D(emap, vUv).rgb * uEmis;
  #else
    col += uEmis;
  #endif
  col = applyFog(col, vW);
  gl_FragColor = vec4(col, uMask);
}`;

// shade colour from a base: darker, a touch more saturated, hue pushed toward red/violet (anime shadow tone)
export function shadeOf(base, { dh = -0.025, ds = 1.12, dl = 0.62 } = {}) {
  const c = C(base), hsl = {}; c.getHSL(hsl); return new THREE.Color().setHSL((hsl.h + dh + 1) % 1, Math.min(1, hsl.s * ds), hsl.l * dl);
}
export function hiOf(base, { dh = 0.012, ds = 0.92, dl = 1.18 } = {}) {
  const c = C(base), hsl = {}; c.getHSL(hsl); return new THREE.Color().setHSL((hsl.h + dh + 1) % 1, Math.min(1, hsl.s * ds), Math.min(0.95, hsl.l * dl));
}

export function toonMaterial({ rig, color = 0xbbbbbb, shade = null, hi = null, mask = 1, term = 0.0, soft = 0.03, hiT = 0.72, hiAmt = 0,
  brush = 0.18, brushF = 2.5, spec = 0, specThr = 0.985, flatSpec = 1, rimW = 0.6, rimI = 0, ambK = 1, keyK = 1, ptK = 1, fill = 0x000000, ambLit = 0.25, pig = 0, pigF = 0.6, lock = 0, trans = 0,
  glow = false, glowColor = 0xffa040, emissive = 0x000000, emisK = 1, map = null, emap = null, side = THREE.FrontSide, transparent = false, wet = false, backK = 1 } = {}) {
  const uni = { ...rig.u,
    uBase: { value: C(color) }, uShade: { value: shade != null ? C(shade) : shadeOf(color) }, uHi: { value: hi != null ? C(hi) : hiOf(color) },
    uTerm: { value: term }, uSoft: { value: soft }, uHiT: { value: hiT }, uHiAmt: { value: hiAmt }, uBrush: { value: brush }, uBrushF: { value: brushF },
    uSpec: { value: spec }, uSpecThr: { value: specThr }, uFlatSpec: { value: flatSpec }, uRimW: { value: rimW }, uRimI: { value: rimI },
    uAmbK: { value: ambK }, uKeyK: { value: keyK }, uPtK: { value: ptK }, uFill: { value: C(fill) }, uMask: { value: mask },
    uGlow: { value: 0 }, uGlowCol: { value: C(glowColor) }, uEmis: { value: C(emissive).multiplyScalar(emisK) }, uSkyK: { value: 1 }, uAmbLit: { value: ambLit }, uPig: { value: pig }, uPigF: { value: pigF }, uLock: { value: lock }, uTrans: { value: trans }, uBackK: { value: backK } };
  const defines = {}; if (glow) defines.GLOW = '';
  if (wet) { defines.WET = ''; Object.assign(uni, { uWet: { value: 0 }, uWetScale: { value: 13 }, uWetDen: { value: 0.32 }, uWetFace: { value: new THREE.Vector4(0, 0, 0.37, 0.27) } }); } if (map) { defines.USE_MAP = ''; uni.map = { value: map }; } if (emap) { defines.USE_EMAP = ''; uni.emap = { value: emap }; }
  const m = new THREE.ShaderMaterial({ uniforms: uni, defines, vertexShader: TOON_VS, fragmentShader: TOON_FS, side, transparent });
  m.extensions = { derivatives: true }; m.userData.toon = true; return m;
}
// backgrounds: no rim band by default (a fresnel rim lights whole flat walls / ground at grazing angles)
export const paintMaterial = (o) => toonMaterial({ mask: 1, brush: 0.22, soft: 0.04, pig: 0.22, rimI: 0, ...o });

// =====================================================================================================
// 3. INK OUTLINE — inverted hull, constant screen thickness (px at the render height), warm dark brown
// =====================================================================================================
export function outlineMaterial({ rig, px = 2.6, color = 0x3a1d14, mask = 0, res = new THREE.Vector2(1920, 1080) } = {}) {
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide,
    uniforms: { ...rig.u, uPx: { value: px }, uRes: { value: res }, uCol: { value: C(color) }, uMask: { value: mask } },
    vertexShader: `uniform float uPx; uniform vec2 uRes; varying vec3 vW;
      void main(){ vec4 p = vec4(position, 1.0); vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
        #endif
        vec4 w = modelMatrix * p; vW = w.xyz; vec3 nw = normalize(transpose(inverse(mat3(modelMatrix))) * n);
        vec4 c = projectionMatrix * viewMatrix * w, cn = projectionMatrix * viewMatrix * vec4(w.xyz + nw * 0.02, 1.0);
        vec2 d = cn.xy / cn.w - c.xy / c.w; float L = length(d); d = L > 1e-7 ? d / L : vec2(0.0);
        c.xy += d * (uPx * 2.0 / uRes) * c.w; gl_Position = c; }`,
    fragmentShader: `${GLSL_FOG} uniform vec3 uCol; uniform float uMask; varying vec3 vW;
      void main(){ gl_FragColor = vec4(applyFog(uCol, vW), uMask); }` });
  return m;
}
// add an ink hull to a mesh (child, follows its pose). Returns the hull mesh.
export function addOutline(mesh, mat) { const h = new THREE.Mesh(mesh.geometry, mat); h.name = (mesh.name || 'mesh') + '_ink'; h.raycast = () => {};
  if (mesh.isInstancedMesh) { const ih = new THREE.InstancedMesh(mesh.geometry, mat, mesh.count); ih.instanceMatrix = mesh.instanceMatrix; ih.raycast = () => {}; mesh.add(ih); return ih; }
  mesh.add(h); return h; }

// =====================================================================================================
// 4. TOONIFY CLAWD — swap the kit's PBR materials for cel materials; face parts become flat inks tinted by the rig
// =====================================================================================================
// Palette measured from mascot/model-sheet.jpg: body D97757 (hue ~15 deg). Shade A9533B (hue ~13; A54B3B = hue 9 read too red at night), highlight F2A27F (hue ~17).
export const CLAWD_PAL = { body: 0xD97757, shade: 0xA9533B, hi: 0xF3A584, ink: 0x3A1D14, faceInk: 0x24140F, glow: 0xFF8A3A };
export function toonify(clawd, { rig, outlinePx = 2.6, outlineColor = CLAWD_PAL.ink, body = CLAWD_PAL.body, shade = CLAWD_PAL.shade, hi = CLAWD_PAL.hi,
  fill = 0x2a1810, term = 0.08, soft = 0.025, hiT = 0.62, hiAmt = 0.85, spec = 0.55, rimW = 0.5, rimI = 1.0, brush = 0.05, ambLit = 0.1, keyK = 1, ptK = 1, lock = 0.55, heroKey = null, glowColor = CLAWD_PAL.glow } = {}) {
  if (!rig) throw new Error('toonify: rig required');
  const root = clawd.root || clawd, M = clawd.materials || {};
  const bodyMat = toonMaterial({ rig, color: body, shade, hi, mask: 0, term, soft, hiT, hiAmt, brush, brushF: 3, spec, specThr: 0.975, flatSpec: 1, rimW, rimI, fill, ambLit, keyK, ptK, lock, glow: true, glowColor, wet: true });
  // hero key: an anime "character light" independent of the set key (own uniforms; the set keeps the rig key)
  if (heroKey) { bodyMat.uniforms.uKeyDir = { value: heroKey.dir.clone().normalize() }; bodyMat.uniforms.uKeyCol = { value: C(heroKey.color ?? 0xffffff).multiplyScalar(heroKey.k ?? 1) }; }
  const inkMat = outlineMaterial({ rig, px: outlinePx, color: outlineColor, mask: 0 });
  const tint = { value: new THREE.Color(1, 1, 1) }, tintHi = { value: new THREE.Color(1, 1, 1) };
  const flat = (hex, t = tint, opts = {}) => maskMat(new THREE.MeshBasicMaterial({ color: C(hex), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, ...opts }), 0, t);
  const faceMats = {
    clawd_ink: flat(CLAWD_PAL.faceInk), clawd_shine: flat(0xffffff, tintHi), clawd_blush: flat(0xF08A7A), clawd_heart: flat(0xE2466A),
    clawd_water: flat(0xA8DDF4, tintHi), clawd_white: flat(0xFFF8F0), clawd_mouth: flat(0x5A1E18), clawd_tongue: flat(0xEC6F78), clawd_tongue_line: flat(0xB8424E),
  };
  const byMat = new Map(Object.entries(M).map(([k, v]) => [v, k]));
  const bodyMeshes = [], hulls = [];
  root.traverse(o => { if (!o.isMesh || o.name.endsWith('_ink')) return; const name = byMat.get(o.material) || o.material?.name;
    o.castShadow = false; o.receiveShadow = false;
    if (name === 'clawd_body') { o.material = bodyMat; bodyMeshes.push(o); } else if (faceMats[name]) o.material = faceMats[name]; });
  for (const m of bodyMeshes) hulls.push(addOutline(m, inkMat));
  const faceNode = clawd.nodes?.face, bodyNode = clawd.nodes?.body || bodyMeshes.find(m => /body/.test(m.name));
  const _p = new V3(), _n = new V3(), _q = new THREE.Quaternion();
  const glowAnchor = new THREE.Object3D(); glowAnchor.name = 'glowAnchor';
  if (bodyNode?.geometry) { bodyNode.geometry.computeBoundingBox(); bodyNode.geometry.boundingBox.getCenter(glowAnchor.position); bodyNode.add(glowAnchor);
    const bb = bodyNode.geometry.boundingBox, sx = bb.max.x - bb.min.x; bodyMat.uniforms.uWetFace.value.set(glowAnchor.position.x, glowAnchor.position.y + 0.02 * sx, 0.37 * sx, 0.29 * sx); } else root.add(glowAnchor);
  const glowPoint = rig.addPoint({ pos: glowAnchor, color: glowColor, intensity: 0, range: 6 });
  const api = {
    rig, body: bodyMat, ink: inkMat, face: faceMats, meshes: bodyMeshes, bodyMesh: bodyNode, hulls, glowPoint, glowAnchor, glow: 0,
    setOutline(px, color) { inkMat.uniforms.uPx.value = px; if (color != null) inkMat.uniforms.uCol.value.copy(C(color)); },
    // film 27: wet vinyl 0..1 (beads + anime highlight strokes); density / bead scale optional
    setWet(k, { den = null, scale = null } = {}) { bodyMat.uniforms.uWet.value = k; if (den != null) bodyMat.uniforms.uWetDen.value = den; if (scale != null) bodyMat.uniforms.uWetScale.value = scale; },
    // self-glow: body emits amber (k 0..~3), spill light on the scene (range scales with k), lines warm up
    setGlow(k, { color = null, spill = 1.6, range = 7 } = {}) { api.glow = k; bodyMat.uniforms.uGlow.value = k; if (color != null) { bodyMat.uniforms.uGlowCol.value.copy(C(color)); glowPoint.color.copy(C(color)); }
      glowPoint.intensity = k * spill; glowPoint.range = range * (0.6 + 0.4 * Math.min(k, 2));
      inkMat.uniforms.uCol.value.copy(C(outlineColor)).lerp(C(0x7a3510), Math.min(1, k * 0.6)); },
    // per frame after the rig update: face inks follow the light on the face (never brighter than 1.0 x a floor)
    update() {
      if (!faceNode) return; faceNode.getWorldPosition(_p); faceNode.getWorldQuaternion(_q); _n.set(0, 0, 1).applyQuaternion(_q);
      const L = rig.lightAt(_p, _n).add(bodyMat.uniforms.uFill.value); const mx = Math.max(L.r, L.g, L.b, 1e-4);
      const k = Math.min(1, mx) / mx; tint.value.copy(L).multiplyScalar(k);
      tint.value.lerp(new THREE.Color(1, 1, 1).multiplyScalar(Math.min(1, mx)), 0.35);       // keep face colours readable
      const g = Math.min(1, api.glow); tint.value.lerp(new THREE.Color(1, 0.86, 0.7), g * 0.8); // glowing: the face is lit from inside
      tintHi.value.setScalar(1);
    },
  };
  return api;
}

// =====================================================================================================
// 5. PRACTICAL LIGHTS — glow source (emissive core + halo + glow sprite + cel spill), light shaft (god-ray / beam)
// =====================================================================================================
export function glowSource({ rig, color = 0xffb066, intensity = 1, core = 0.12, coreK = 6, halo = 0.9, haloK = 0.5, glow = 3.2, glowK = 0.18,
  spill = 1.6, range = 8, coreGeo = null, coreMap = null, depthTestGlow = true } = {}) {
  const col = C(color), g = new THREE.Group(); g.name = 'glowSource';
  const coreMat = maskMat(new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(coreK), map: coreMap }), 0);
  const coreMesh = new THREE.Mesh(coreGeo || new THREE.SphereGeometry(core, 20, 14), coreMat); g.add(coreMesh);
  const sp = (k, s, dt) => { const m = addBlend(new THREE.SpriteMaterial({ map: glowTexture(), color: col.clone().multiplyScalar(k), depthTest: dt })); const o = new THREE.Sprite(m); o.scale.setScalar(s); g.add(o); return o; };
  const haloS = sp(haloK, halo, true), glowS = sp(glowK, glow, depthTestGlow);
  const point = rig ? rig.addPoint({ pos: g, color: col, intensity: spill, range }) : null;
  const base = { coreK, haloK, glowK, spill };
  g.userData = { core: coreMesh, halo: haloS, glowSprite: glowS, point, color: col };
  g.set = (k) => { intensity = k; coreMat.color.copy(col).multiplyScalar(base.coreK * k); haloS.material.color.copy(col).multiplyScalar(base.haloK * k);
    glowS.material.color.copy(col).multiplyScalar(base.glowK * k); if (point) point.intensity = base.spill * k; coreMesh.visible = k > 0.001; haloS.visible = glowS.visible = k > 0.001; return g; };
  // nudge the sprites toward the lens so they are not cut by the surface they sit on
  g.update = (camera, nudge = 0.15) => { const wp = g.getWorldPosition(new V3()), d = camera.position.clone().sub(wp).normalize().multiplyScalar(nudge);
    const inv = g.parent ? g.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion(); d.applyQuaternion(inv);
    haloS.position.copy(d); glowS.position.copy(d).multiplyScalar(2); };
  g.set(intensity); return g;
}

// Volumetric shaft: open cone from `from` (radius r0) to `to` (radius r1). Additive, soft view-dependent edges,
// streaky dust noise drifting along it, fades near the lens. Use for lighthouse beams and window god rays.
export function lightShaft({ from = new V3(), to = new V3(0, 0, -10), r0 = 0.1, r1 = 2, color = 0xffd9a0, intensity = 0.6, fall = 1.4, edge = 1.6, streak = 0.5, segs = 48 } = {}) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, segs, 32, true); geo.translate(0, 0.5, 0); geo.rotateX(-Math.PI / 2);   // apex at origin, along -Z (z in [-1, 0])
  const mat = addBlend(new THREE.ShaderMaterial({ side: THREE.DoubleSide,
    uniforms: { uCol: { value: C(color) }, uI: { value: intensity }, uFall: { value: fall }, uEdge: { value: edge }, uStreak: { value: streak }, uTime: { value: 0 }, uR0: { value: r0 }, uR1: { value: r1 }, uLen: { value: 1 } },
    vertexShader: `uniform float uR0, uR1, uLen; varying float vV, vA; varying vec3 vW, vNw;
      void main(){ float v = -position.z; vV = v; vA = atan(position.y, position.x);
        float r = mix(uR0, uR1, v); vec3 p = vec3(position.xy * r, -v * uLen);
        vec3 n = normalize(vec3(position.xy, (uR1 - uR0) / uLen));
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; vNw = normalize(mat3(modelMatrix) * n); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GLSL_NOISE} uniform vec3 uCol; uniform float uI, uFall, uEdge, uStreak, uTime; varying float vV, vA; varying vec3 vW, vNw;
      void main(){ vec3 V = normalize(cameraPosition - vW); float e = pow(clamp(abs(dot(normalize(vNw), V)), 0.0, 1.0), uEdge);
        float v = clamp(vV, 0.0, 1.0);   // NaN guard: pow(negative) would poison the bloom chain (black blocks)
        float s = 1.0 - uStreak + uStreak * (0.55 * n2(vec2(vA * 7.0, v * 3.0 - uTime * 0.25)) + 0.45 * n2(vec2(vA * 19.0, v * 9.0 + uTime * 0.1)));
        float f = pow(1.0 - v, uFall) * smoothstep(0.0, 0.04, v);
        float near = smoothstep(0.5, 3.0, length(cameraPosition - vW));
        gl_FragColor = vec4(uCol * uI * e * s * f * near, 1.0); }` }));
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 5; m.raycast = () => {};
  m.aim = (a, b, ra = r0, rb = r1) => { m.position.copy(a); const L = a.distanceTo(b); mat.uniforms.uLen.value = L; mat.uniforms.uR0.value = ra; mat.uniforms.uR1.value = rb;
    m.lookAt(b); m.rotateY(Math.PI); m.updateMatrixWorld(); return m; };   // lookAt points +Z at b; the cone runs along -Z
  m.aim(from, to); return m;
}

// =====================================================================================================
// 6. PAINTED BACKGROUNDS — sky dome (gradient + cel cloud bands + brush streaks + moon/sun), stars, cloud sea, paper
// =====================================================================================================
// stops: [[elev, hex], ...] elevation -0.2..1 (0 = horizon). clouds: bands of painted cumulus/strato with 2-3 cel tones.
export function paintedSky({ stops = [[-0.1, 0x2a2550], [0.0, 0x8d7fc0], [0.25, 0x463d86], [0.7, 0x14123a]], radius = 1800,
  clouds = { lit: 0xd9c8f0, mid: 0x8c7cc4, shade: 0x4a3f86, e0: 0.02, e1: 0.30, cover: 0.48, scale: 1.2, stretch: 3.0, seed: 1.0, rim: 0xfff0e0, rimK: 0.0 },
  moon = null, sunGlow = null, brush = 0.035, mask = 1 } = {}) {
  const st = stops.slice(0, 6); while (st.length < 6) st.push(st[st.length - 1]);
  const cl = { lit: 0xd9c8f0, mid: 0x8c7cc4, shade: 0x4a3f86, e0: 0.02, e1: 0.3, cover: 0.48, scale: 1.2, stretch: 3, seed: 1, rim: 0xfff0e0, rimK: 0, ...(clouds || {}) };
  const mo = { dir: new V3(-0.4, 0.45, -0.8).normalize(), size: 0.035, color: 0xfff6e0, k: 2.2, halo: 0.6, haloW: 0.25, ...(moon || {}) };
  const sg = { dir: new V3(0, 0.05, -1).normalize(), color: 0xffb070, k: 0, w: 0.35, ...(sunGlow || {}) };
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    uniforms: { uE: { value: st.map(s => s[0]) }, uC: { value: st.map(s => C(s[1])) }, uCLit: { value: C(cl.lit) }, uCMid: { value: C(cl.mid) }, uCSh: { value: C(cl.shade) }, uCRim: { value: C(cl.rim).multiplyScalar(cl.rimK) },
      uCl: { value: new THREE.Vector4(cl.e0, cl.e1, cl.cover, cl.scale) }, uStretch: { value: cl.stretch }, uSeed: { value: cl.seed }, uClOn: { value: clouds ? 1 : 0 },
      uMoonDir: { value: mo.dir }, uMoon: { value: new THREE.Vector4(mo.size, mo.k, mo.halo, mo.haloW) }, uMoonCol: { value: C(mo.color) }, uMoonOn: { value: moon ? 1 : 0 },
      uSunDir: { value: sg.dir }, uSunCol: { value: C(sg.color).multiplyScalar(sg.k) }, uSunW: { value: sg.w }, uBrush: { value: brush }, uMask: { value: mask }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: `${GLSL_NOISE}
      uniform float uE[6]; uniform vec3 uC[6]; uniform vec3 uCLit, uCMid, uCSh, uCRim, uMoonCol, uSunCol, uMoonDir, uSunDir; uniform vec4 uCl, uMoon;
      uniform float uStretch, uSeed, uClOn, uMoonOn, uSunW, uBrush, uMask, uTime; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float e = d.y; float az = atan(d.x, -d.z);
        // brush streaks: long horizontal strokes of slightly different value
        float bs = (n2(vec2(az * 3.0, e * 90.0)) - 0.5) * 0.6 + (n2(vec2(az * 11.0, e * 260.0)) - 0.5) * 0.4;
        float ee = e + bs * uBrush * 0.25;
        vec3 col = uC[0];
        for (int i = 1; i < 6; i++) col = mix(col, uC[i], smoothstep(uE[i - 1], uE[i], ee));
        col *= 1.0 + bs * uBrush;
        // sun / moon glow in the sky (soft, painted)
        float sd = max(dot(d, uSunDir), 0.0); col += uSunCol * (pow(sd, 8.0 / uSunW) * 0.6 + pow(sd, 64.0) * 0.6);
        if (uMoonOn > 0.5) { float md = dot(d, uMoonDir); float r = acos(clamp(md, -1.0, 1.0));
          col += uMoonCol * uMoon.z * (exp(-r / max(uMoon.w, 1e-3) * 6.0) * 0.5 + exp(-r * r / (uMoon.x * uMoon.x * 9.0)) * 0.6); }
        // cloud bands (cel stepped: shade / mid / lit, + optional silver rim toward the light)
        if (uClOn > 0.5) {
          vec2 cp = vec2(az * 6.0 * uCl.w, (1.0 / max(e + 0.06, 0.02)) * 0.9 * uCl.w); cp.x *= 1.0; cp.y *= uStretch;
          cp += uSeed * 13.1;
          float band = smoothstep(uCl.x - 0.03, uCl.x + 0.03, e) * (1.0 - smoothstep(uCl.y - 0.08, uCl.y, e));
          float c = fbm2(cp * vec2(1.0, 0.35)) + 0.25 * fbm2(cp * vec2(3.0, 1.2) + 4.0);
          float cov = c * band; float thr = 1.0 - uCl.z;
          float m0 = smoothstep(thr - 0.012, thr + 0.012, cov);
          vec2 ld = normalize(vec2(uSunDir.x + uMoonDir.x * uMoonOn, 1.0)) * 0.08;
          float c2 = fbm2((cp - vec2(0.0, 0.35)) * vec2(1.0, 0.35)) + 0.25 * fbm2((cp - vec2(0.0, 0.35)) * vec2(3.0, 1.2) + 4.0);
          float lit = smoothstep(-0.01, 0.02, (c - c2) + (e - uCl.x) * 0.2);
          float top = smoothstep(thr + 0.06, thr + 0.09, cov);
          vec3 cc = mix(uCSh, uCMid, lit); cc = mix(cc, uCLit, lit * top);
          cc += uCRim * (m0 - smoothstep(thr + 0.0, thr + 0.03, cov));
          col = mix(col, cc, m0);
        }
        if (uMoonOn > 0.5) { float md = dot(d, uMoonDir); float disc = smoothstep(cos(uMoon.x * 1.04), cos(uMoon.x), md);
          float crater = 0.85 + 0.15 * fbm2(vec2(az, e) * 220.0); col = mix(col, uMoonCol * uMoon.y * crater, disc); }
        gl_FragColor = vec4(col, uMask); }` });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat); m.frustumCulled = false; m.renderOrder = -10; m.raycast = () => {};
  m.onBeforeRender = (r, s, cam) => { m.position.copy(cam.position); m.updateMatrixWorld(); };
  return m;
}

export function starField({ count = 1400, radius = 1500, seed = 7, minE = 0.03, size = [1.0, 3.2], bright = 1.4, mask = 0.2 } = {}) {
  const R = rng(seed), pos = [], sz = [], col = [], ph = [];
  for (let i = 0; i < count; i++) { const e = minE + (1 - minE) * Math.pow(R(), 0.8), a = R() * Math.PI * 2, c = Math.sqrt(1 - e * e);
    pos.push(Math.sin(a) * c * radius, e * radius, -Math.cos(a) * c * radius); const big = R() < 0.03;
    sz.push(big ? size[1] * (1.4 + R()) : size[0] + (size[1] - size[0]) * Math.pow(R(), 3)); const w = R(); col.push(0.85 + 0.15 * w, 0.85 + 0.1 * R(), 0.9 + 0.1 * (1 - w)); ph.push(R() * 6.28); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
  const mat = cutBlend(new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uB: { value: bright }, uMask: { value: mask } },
    vertexShader: `attribute float aSize, aPh; attribute vec3 aCol; uniform float uTime; varying vec3 vC; varying float vS;
      void main(){ vC = aCol * (0.75 + 0.25 * sin(uTime * (1.5 + fract(aPh * 3.1) * 2.0) + aPh)); vS = aSize;
        vec4 w = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w * 0.99998; gl_PointSize = aSize * 3.0; }`,
    fragmentShader: `uniform float uB, uMask; varying vec3 vC; varying float vS;
      void main(){ vec2 q = gl_PointCoord - 0.5; float r = length(q) * 3.0; float a = exp(-r * r * 3.0);
        if (vS > 3.5) a += 0.5 * exp(-abs(q.x) * 40.0) * exp(-abs(q.y) * 5.0) + 0.5 * exp(-abs(q.y) * 40.0) * exp(-abs(q.x) * 5.0);
        gl_FragColor = vec4(vC * uB * (1.0 + a), clamp(a, 0.0, 1.0) * (1.0 - uMask)); }` }), true);
  const p = new THREE.Points(g, mat); p.frustumCulled = false; p.renderOrder = -9;
  p.onBeforeRender = (r, s, cam) => { p.position.copy(cam.position); p.updateMatrixWorld(); mat.uniforms.uTime.value = s.userData.time || 0; };
  return p;
}

// Sea of clouds: instanced cel-shaded puffs (spheres) in clusters on a plane + a flat underlay; key light = moon/sun.
export function cloudSea({ rig, y = 0, radius = 300, inner = 0, clusters = 260, seed = 3, size = [2, 7], color = 0xc9b8ea, shade = 0x5a4b9a, hi = 0xf2e6ff,
  avoid = [], center = new V3(), hiAmt = 0.9, term = 0.1, brush = 0.3, rimI = 0.8, flat = true } = {}) {
  const R = rng(seed), mats = [], g = new THREE.Group(), Q0 = new THREE.Quaternion();
  const put = (x, yy, z, sx, sy, sz) => mats.push(new THREE.Matrix4().compose(new V3(x, yy, z), Q0, new V3(sx, sy, sz)));
  // cumulus "cauliflower" clusters: flat wide base -> body puffs -> small top puffs (sizes shrink upward)
  for (let c = 0; c < clusters; c++) {
    let a = R() * Math.PI * 2, r = inner + (radius - inner) * Math.sqrt(R()), cx = center.x + Math.cos(a) * r, cz = center.z + Math.sin(a) * r;
    if (avoid.some(([ax, az, ar]) => Math.hypot(cx - ax, cz - az) < ar)) continue;
    const B = size[0] + (size[1] - size[0]) * Math.pow(R(), 1.6), tall = 0.6 + 0.8 * R();
    for (let i = 0; i < 3; i++) put(cx + (R() - 0.5) * B * 1.6, y + B * 0.12, cz + (R() - 0.5) * B * 1.0, B * (1.1 + 0.4 * R()), B * 0.42, B * (0.9 + 0.3 * R()));
    const nb = 4 + Math.floor(R() * 5);
    for (let i = 0; i < nb; i++) { const s = B * (0.45 + 0.3 * R()), ox = (R() - 0.5) * B * 1.9, oz = (R() - 0.5) * B * 1.1;
      put(cx + ox, y + B * 0.25 + s * (0.5 + 0.4 * tall) * (1 - Math.abs(ox) / (B * 1.4)), cz + oz, s, s * 0.92, s); }
    const nt = Math.floor(R() * 6 * tall);
    for (let i = 0; i < nt; i++) { const s = B * (0.22 + 0.2 * R()), ox = (R() - 0.5) * B * 1.0, oz = (R() - 0.5) * B * 0.7;
      put(cx + ox, y + B * (0.55 + 0.45 * tall) + s * 0.3 * R(), cz + oz, s, s, s); } }
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const mat = toonMaterial({ rig, color, shade, hi, hiAmt, hiT: 0.42, term, soft: 0.06, brush, brushF: 0.5, rimW: 0.62, rimI, mask: 1, pig: 0.12, pigF: 0.15, ambLit: 0.35 });
  const im = new THREE.InstancedMesh(geo, mat, mats.length); mats.forEach((m, i) => { im.setMatrixAt(i, m); const v = 0.9 + 0.12 * R(); im.setColorAt(i, new THREE.Color(v, v, v * (0.98 + 0.04 * R()))); });
  im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; g.add(im);
  if (flat) { const pl = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.6, 64).rotateX(-Math.PI / 2), toonMaterial({ rig, color: shade, shade, hi: shade, mask: 1, brush: 0, rimI: 0, ambLit: 0.35 })); pl.position.set(center.x, y + 0.3, center.z); g.add(pl); }
  g.userData = { mesh: im, material: mat }; return g;
}

// ---- 2.5D painted cloud cards (matte-painting layers): Y-billboards whose shader paints a sculpted cumulus ----
// Puffs = smooth union of circles (generated per seed: wide flat base -> body mounds -> small top puffs), each puff
// shaded as a sphere toward the key light (cel bands: shade / mid / lit + silver rim), soft painted underside,
// eroded wispy edges, pigment variation; fogged by the rig. Alpha keeps the paint mask (overBlend).
const CARD_N = 28;
function cumulusPuffs(R, aspect, { tall = 0.7, flat = 0.22 } = {}) {
  const P = []; const nb = 5 + Math.floor(R() * 4);
  for (let i = 0; i < nb; i++) { const x = aspect * (0.12 + 0.76 * (i + 0.5) / nb + (R() - 0.5) * 0.08); P.push([x, flat + 0.04 + R() * 0.05, (0.11 + R() * 0.07) * Math.min(aspect, 2.2)]); }
  const nm = 4 + Math.floor(R() * 5);
  for (let i = 0; i < nm; i++) { const x = aspect * (0.25 + 0.5 * R()); P.push([x, flat + 0.18 + tall * 0.28 * R(), (0.12 + R() * 0.1) * Math.min(aspect, 2.2)]); }
  const nt = 2 + Math.floor(R() * 5 * tall);
  for (let i = 0; i < nt; i++) { const x = aspect * (0.33 + 0.34 * R()); P.push([x, flat + 0.38 + tall * 0.4 * R(), (0.06 + R() * 0.07) * Math.min(aspect, 2.2)]); }
  return P.slice(0, CARD_N);
}
export function cloudCard({ rig, w = 20, h = 10, seed = 1, lit = 0xf4e8ff, mid = 0xb8a8e8, shade = 0x7464b8, under = 0x5a4c9c, rim = 0xfff2e0, rimK = 0.6,
  tall = 0.7, flat = 0.22, wisp = 1.0, erode = 1.0, opacity = 1 } = {}) {
  const R = rng(seed), aspect = w / h, P = cumulusPuffs(R, aspect, { tall, flat }); while (P.length < CARD_N) P.push([0, 0, 0]);
  const mat = overBlend(new THREE.ShaderMaterial({ side: THREE.DoubleSide,
    uniforms: { ...rig.u, uP: { value: P.map(p => new V3(...p)) }, uN: { value: P.filter(p => p[2] > 0).length }, uAsp: { value: aspect }, uL: { value: new V3(0, 1, 0.3) },
      uLit: { value: C(lit) }, uMid: { value: C(mid) }, uSh: { value: C(shade) }, uUnder: { value: C(under) }, uRim: { value: C(rim).multiplyScalar(rimK) }, uFlat: { value: flat },
      uWisp: { value: wisp }, uErode: { value: erode }, uSeed: { value: seed * 7.13 % 50 }, uOp: { value: opacity } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GLSL_NOISE} ${GLSL_FOG}
      uniform vec3 uP[${CARD_N}]; uniform int uN; uniform float uAsp, uFlat, uWisp, uErode, uSeed, uOp; uniform vec3 uL, uLit, uMid, uSh, uUnder, uRim; varying vec2 vUv; varying vec3 vW;
      void main(){ vec2 p = vec2(vUv.x * uAsp, vUv.y);
        float s = 0.0, best = -9.0; vec3 bc = vec3(0.5, 0.5, 1.0);
        for (int i = 0; i < ${CARD_N}; i++){ if (i >= uN) break; vec3 c = uP[i]; float k = 1.0 - length(p - c.xy) / c.z; s += exp(k * 10.0); if (k > best) { best = k; bc = c; } }
        float d = log(max(s, 1e-6)) / 10.0;
        float er = ((fbm2(p * vec2(7.0, 6.0) + uSeed) - 0.5) * 0.22 + (n2(p * 38.0 + uSeed) - 0.5) * 0.07) * uErode;
        float wisp = (fbm2(vec2(p.x * 5.0, p.y * 26.0) + uSeed) - 0.5) * 0.10 * uWisp;
        float base = smoothstep(uFlat - 0.05, uFlat + 0.07, p.y + wisp);
        float D = d + er; float cov = smoothstep(0.0, 0.035, D) * mix(0.25, 1.0, base);
        cov *= smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x) * smoothstep(1.0, 0.97, vUv.y);
        if (cov < 0.004) discard;
        vec2 q = (p - bc.xy) / bc.z; float l2 = dot(q, q); vec3 n = normalize(vec3(q, sqrt(max(1.0 - l2, 0.0)) + 0.15));
        float br = (fbm2(p * 9.0 + uSeed * 2.0) - 0.5) * 0.35;
        float nl = dot(n, normalize(uL)) + br;
        vec3 col = mix(uSh, uMid, smoothstep(-0.12, -0.04, nl)); col = mix(col, uLit, smoothstep(0.32, 0.4, nl));
        float edge = 1.0 - smoothstep(0.0, 0.09, D); col += uRim * edge * smoothstep(0.0, 0.3, dot(n.xy, normalize(uL.xy)));
        col = mix(col, uUnder, (1.0 - smoothstep(uFlat - 0.02, uFlat + 0.22, p.y)) * 0.75);   // soft painted underside
        col *= 1.0 + (fbm2(p * 3.0 + uSeed * 3.0) - 0.5) * 0.14;
        gl_FragColor = vec4(applyFog(col, vW), cov * uOp); }` }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2 - h * flat * 0.6, 0), mat); m.renderOrder = -5; m.raycast = () => {};
  const qi = new THREE.Quaternion(), lv = new V3();
  m.onBeforeRender = (r, sc, cam) => { m.rotation.set(0, Math.atan2(cam.position.x - m.position.x, cam.position.z - m.position.z), 0); m.updateMatrixWorld();
    qi.copy(m.quaternion).invert(); lv.copy(rig.u.uRimDir.value).multiplyScalar(0.0).add(rig.u.uKeyDir.value).applyQuaternion(qi); mat.uniforms.uL.value.copy(lv); };
  m.userData.light = (dir) => { m.onBeforeRender = (r, sc, cam) => { m.rotation.set(0, Math.atan2(cam.position.x - m.position.x, cam.position.z - m.position.z), 0); m.updateMatrixWorld();
    qi.copy(m.quaternion).invert(); mat.uniforms.uL.value.copy(dir).applyQuaternion(qi); }; };
  return m;
}
// a field of cards on a plane (sizes grow with distance so the horizon stays dense); light = direction toward the light
export function cloudBank({ rig, center = new V3(), y = 0, rMin = 20, rMax = 400, count = 60, seed = 3, size = [14, 40], light = null, avoid = [], camPos = null, ...cardOpts } = {}) {
  const R = rng(seed), g = new THREE.Group();
  for (let i = 0; i < count; i++) { const a = R() * Math.PI * 2, r = rMin + (rMax - rMin) * Math.pow(R(), 0.8), x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    const k = r / rMax, w = size[0] + (size[1] - size[0]) * (0.3 + 0.7 * k) * (0.6 + 0.8 * R()), h = w * (0.35 + 0.25 * R());
    const c = cloudCard({ rig, w, h, seed: seed * 100 + i, tall: 0.3 + 0.9 * R(), ...cardOpts }); c.position.set(x, y, z); if (light) c.userData.light(light); g.add(c); }
  return g;
}
// painted top-view cloud floor (the sea of clouds between cards): fbm puffs, cel-shaded from the fbm gradient
export function cloudFloor({ rig, y = 0, size = 1600, scale = 0.035, lit = 0xd8ccf4, mid = 0xa898dc, shade = 0x6e5eb2, light = new V3(0, 1, 0), seed = 2 } = {}) {
  const mat = new THREE.ShaderMaterial({ uniforms: { ...rig.u, uS: { value: scale }, uLit: { value: C(lit) }, uMid: { value: C(mid) }, uSh: { value: C(shade) }, uL: { value: light.clone().normalize() }, uSeed: { value: seed } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GLSL_NOISE} ${GLSL_FOG} uniform float uS, uSeed; uniform vec3 uLit, uMid, uSh, uL; varying vec3 vW;
      float H(vec2 p){ return fbm2(p) + 0.5 * fbm2(p * 2.7 + 5.0); }
      void main(){ vec2 p = vW.xz * uS + uSeed; float e = 0.04; float h = H(p), hx = H(p + vec2(e, 0.0)), hz = H(p + vec2(0.0, e));
        vec3 n = normalize(vec3(-(hx - h) / e, 0.35, -(hz - h) / e)); float nl = dot(n, uL) + (n2(p * 30.0) - 0.5) * 0.15;
        vec3 col = mix(uSh, uMid, smoothstep(0.05, 0.12, nl)); col = mix(col, uLit, smoothstep(0.45, 0.52, nl) * smoothstep(0.55, 0.75, h));
        col *= 0.85 + 0.3 * smoothstep(0.3, 0.8, h);
        gl_FragColor = vec4(applyFog(col, vW), 1.0); }` });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat); m.position.y = y; return m;
}

// fullscreen-ish paper backdrop (model sheets, end cards): warm paper + fibres + faint grid
export function paperMaterial({ color = 0xEFE4CF, grid = 0.0, mask = 0.6, tone = 0.06 } = {}) {
  return new THREE.ShaderMaterial({ uniforms: { uCol: { value: C(color) }, uGrid: { value: grid }, uMask: { value: mask }, uTone: { value: tone } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GLSL_NOISE} uniform vec3 uCol; uniform float uGrid, uMask, uTone; varying vec2 vUv; varying vec3 vW;
      void main(){ vec2 p = vUv * vec2(16.0, 9.0);
        float f = fbm2(p * 3.0) - 0.5, fib = n2(vec2(p.x * 40.0, p.y * 3.0)) * n2(vec2(p.x * 7.0, p.y * 90.0));
        vec3 c = uCol * (1.0 + f * uTone * 2.0 - fib * uTone * 0.8);
        vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.35;
        if (uGrid > 0.0) { vec2 g = abs(fract(p * 2.0) - 0.5); float l = 1.0 - smoothstep(0.0, 0.012, min(g.x, g.y)); c = mix(c, c * vec3(0.78, 0.84, 0.95), l * uGrid); }
        gl_FragColor = vec4(c, uMask); }` });
}

// =====================================================================================================
// 7. WEATHER — rain streaks (with "beam" brightening), frozen drops (tiny lenses with neon glints)
// =====================================================================================================
// box = [w, h, d] around `center`; tints[] = per-drop colour picks (neon alleys); beam = { o: V3, d: V3, r, k } brightens drops inside a beam.
export function rain({ count = 6000, center = new V3(), box = [30, 20, 30], speed = 18, len = 0.6, width = 0.012, wind = new V3(0.18, 0, 0.05),
  color = 0xbfd0e8, alpha = 0.45, tints = null, seed = 11, beam = null, shelter = null } = {}) {   // shelter = { pos: V3 (top centre), r } : no rain under it (leaf, eave)
  const R = rng(seed), quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute('position', quad.getAttribute('position')); g.setAttribute('uv', quad.getAttribute('uv'));
  const off = [], rnd = [], tc = []; const T = (tints || [color]).map(C);
  for (let i = 0; i < count; i++) { off.push(R(), R(), R()); rnd.push(R(), R()); const c = T[Math.floor(R() * T.length)]; tc.push(c.r, c.g, c.b); }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(off), 3)); g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(new Float32Array(rnd), 2));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(tc), 3)); g.instanceCount = count;
  const bm = beam || { o: new V3(), d: new V3(1, 0, 0), r: 0, k: 0 };
  const mat = cutBlend(new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uC: { value: center }, uBox: { value: new V3(...box) }, uSpeed: { value: speed }, uLen: { value: len }, uW: { value: width },
      uWind: { value: wind }, uA: { value: alpha }, uFreeze: { value: 0 }, uBO: { value: bm.o }, uBD: { value: bm.d }, uBR: { value: bm.r }, uBK: { value: bm.k }, uBCol: { value: C(bm.color ?? 0xffc070) },
      uSh: { value: shelter ? new THREE.Vector4(shelter.pos.x, shelter.pos.y, shelter.pos.z, shelter.r) : new THREE.Vector4(0, -1e5, 0, 0) } },
    vertexShader: `attribute vec3 aOff, aCol; attribute vec2 aRnd; uniform float uTime, uSpeed, uLen, uW, uFreeze; uniform vec3 uC, uBox, uWind, uBO, uBD; uniform float uBR, uBK; uniform vec4 uSh;
      varying vec2 vUv; varying vec3 vCol; varying float vB, vFade;
      void main(){ vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.z));
        float sp = uSpeed * (0.8 + 0.4 * aRnd.x) * (1.0 - uFreeze);
        vec3 p = aOff * uBox; p.y = mod(p.y - uTime * sp, uBox.y); p.xz += -dir.xz * (uBox.y - p.y) * 0.0; p = uC + p - uBox * vec3(0.5, 0.0, 0.5);
        vec3 V = normalize(cameraPosition - p); vec3 side = normalize(cross(dir, V));
        float L = uLen * (0.7 + 0.6 * aRnd.y) * mix(1.0, 0.06, uFreeze);
        vec3 w = p + dir * L * (position.y - 0.5) + side * uW * position.x * (1.0 + 2.0 * uFreeze);
        if (length(p.xz - uSh.xz) < uSh.w && p.y < uSh.y + L) w = p;   // sheltered: collapse the streak
        vUv = uv; vCol = aCol;
        vec3 q = p - uBO; float along = dot(q, uBD); float dd = length(q - uBD * along); vB = uBK * step(0.0, along) * exp(-dd * dd / max(uBR * uBR, 1e-4)) * (1.0 / (1.0 + along * 0.03));
        float dc = length(cameraPosition - p); vFade = smoothstep(0.6, 2.5, dc) * (1.0 - smoothstep(uBox.x * 0.9, uBox.x * 1.6, dc));
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
    fragmentShader: `uniform float uA; uniform vec3 uBCol; varying vec2 vUv; varying vec3 vCol; varying float vB, vFade;
      void main(){ float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.35, vUv.y) * (0.4 + 0.6 * vUv.y);
        vec3 c = vCol + uBCol * vB * 3.0; float al = clamp(a * (uA + vB * 0.6) * vFade, 0.0, 1.0);
        gl_FragColor = vec4(c * al, clamp(al * 4.0, 0.0, 1.0)); }` }), 'premult');
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 8; mesh.raycast = () => {};
  mesh.onBeforeRender = (r, s) => { mat.uniforms.uTime.value = s.userData.time || 0; };
  return mesh;
}

// Frozen rain v2: drops hanging in the air, depth-layered by distance to the lens.
//   near (< nearD): real little lenses — slight teardrop, the scene behind seen FLIPPED and magnified inside
//                   (samples a capture of the scene without drops), crisp white highlight, thin dark edge
//   mid:            small sharp glints (neon catchlights from the rig points + one white spark)
//   far (> farD):   soft bokeh discs tinted by the neon behind them
// Per frame: post.before.push((r, s, c) => drops.userData.capture(r, s, c, [hide...])) BEFORE the mirror pass.
export function frozenDrops({ rig, count = 1600, center = new V3(), box = [12, 6, 12], size = [0.02, 0.05], seed = 21, nearD = 2.6, farD = 6.5,
  glint = 2.5, keep = null, camPos = null, res = [960, 540] } = {}) {
  const R = rng(seed), mats = [], cp = camPos || new V3(0, 1, 5);
  for (let i = 0, k = 0; i < count * 6 && k < count; i++) { const p = new V3((R() - 0.5) * box[0], R() * box[1], (R() - 0.5) * box[2]).add(center);
    if (keep && !keep(p)) continue; const d = p.distanceTo(cp);
    // depth layering: thin out the near layer (few, big lenses), keep mids, far ones a bit bigger (bokeh)
    if (d < nearD && R() > 0.35) continue;
    const s = (size[0] + (size[1] - size[0]) * Math.pow(R(), 1.5)) * (d < nearD ? 1.8 : d > farD ? 1.5 : 0.8);
    mats.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), (R() - 0.5) * 0.15), new V3(s, s, s))); k++; }
  const geo = new THREE.SphereGeometry(1, 28, 18); const pa = geo.attributes.position, v = new V3();
  for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); if (v.y > 0) { const t = v.y; v.x *= 1 - 0.55 * t * t; v.z *= 1 - 0.55 * t * t; v.y *= 1 + 0.45 * t; } v.y *= 1.05; pa.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  const rt = new THREE.WebGLRenderTarget(res[0], res[1], { type: THREE.HalfFloatType, samples: 2 });
  const mat = cutBlend(new THREE.ShaderMaterial({ uniforms: { ...rig.u, tScene: { value: rt.texture }, uGl: { value: glint }, uNear: { value: nearD }, uFar: { value: farD }, uRes: { value: new THREE.Vector2(1920, 1080) } },
    vertexShader: `varying vec3 vN, vW, vC; varying float vS; varying vec4 vCC;
      void main(){ vec4 p = instanceMatrix * vec4(position, 1.0); vec4 w = modelMatrix * p; vW = w.xyz; vC = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vCC = projectionMatrix * viewMatrix * vec4(vC, 1.0); vS = length(instanceMatrix[0].xyz); vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GLSL_FOG} uniform sampler2D tScene; uniform vec2 uRes; uniform float uGl, uNear, uFar; uniform vec3 uKeyDir, uKeyCol;
      uniform vec3 uPPos[${MAXP}]; uniform vec3 uPCol[${MAXP}]; uniform int uPN; varying vec3 vN, vW, vC; varying float vS; varying vec4 vCC;
      void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vW); float ndv = clamp(dot(N, V), 0.0, 1.0);
        float dist = length(cameraPosition - vC); float near = 1.0 - smoothstep(uNear * 0.85, uNear * 1.15, dist), far = smoothstep(uFar * 0.8, uFar * 1.2, dist), mid = max(0.0, 1.0 - near - far);
        vec2 sc = vCC.xy / vCC.w * 0.5 + 0.5; vec2 fs = gl_FragCoord.xy / uRes;
        // lens: the world behind, flipped through the centre and slightly magnified, plus the drop's own refraction bend
        vec2 ruv = sc - (fs - sc) * 1.6 + N.xy * 0.004; vec3 inside = texture2D(tScene, clamp(ruv, 0.001, 0.999)).rgb;
        vec3 Rv = reflect(-V, N);
        float hl = smoothstep(0.93, 0.955, dot(Rv, normalize(vec3(-0.35, 0.75, 0.55))));
        float gl = 0.0; vec3 glc = vec3(0.0);
        for (int i = 0; i < ${MAXP}; i++){ if (i >= uPN) break; vec3 L = normalize(uPPos[i] - vW); float g = smoothstep(0.955, 0.975, dot(Rv, L));
          vec3 pc = uPCol[i] / max(max(uPCol[i].r, max(uPCol[i].g, uPCol[i].b)), 1e-3); glc += (pc * 0.6 + 0.4) * g; gl += g; }
        float edge = smoothstep(0.18, 0.05, ndv);   // thin dark rim
        vec3 ins = min(mix(vec3(dot(inside, vec3(0.3, 0.59, 0.11))), inside, 1.35) * 1.15, vec3(1.1)); vec3 lens = ins * (1.0 - edge * 0.92) + vec3(1.0) * hl * 3.0 + glc * uGl;
        float aLens = smoothstep(0.0, 0.06, ndv) * 0.97;
        vec3 bk0 = texture2D(tScene, sc).rgb; vec3 gcol = min(bk0, vec3(1.0)) * 1.3 + 0.45 + glc * uGl * 0.5; float aMid = smoothstep(0.62, 0.9, ndv) * 0.95;
        vec3 bk = bk0; vec3 bcol = min(bk, vec3(1.2)) * 0.9 + 0.03; float aFar = smoothstep(0.0, 0.7, ndv) * 0.4;
        vec3 col = lens * near + gcol * mid + bcol * far; float a = aLens * near + aMid * mid + aFar * far;
        gl_FragColor = vec4(applyFog(col, vW) * a, clamp(a, 0.0, 1.0)); }` }), 'premult');
  // premult needs a normal-over colour blend for the opaque lens: switch dst colour factor to OneMinusSrcAlpha
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  const im = new THREE.InstancedMesh(geo, mat, mats.length); mats.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.renderOrder = 7;
  im.userData.capture = (renderer, scene, camera, hide = []) => { const vis = [im, ...hide].map(o => [o, o.visible]); vis.forEach(([o]) => o.visible = false);
    const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, camera); renderer.setRenderTarget(prev); vis.forEach(([o, vv]) => o.visible = vv); };
  return im;
}

// =====================================================================================================
// 8. WET GROUND — planar mirror (half res) smeared vertically + rippled, puddles = sharp mirror, asphalt = blurry sheen;
//    the base is a cel toon floor lit by the rig (neon pools from the spill points).
// =====================================================================================================
export function wetGround({ rig, w = 40, d = 80, y = 0, color = 0x2a2b36, puddle = 0.5, refl = 0.75, smear = 1.0, seed = 2, mask = 1, res = [960, 540], ripples = 1 } = {}) {
  const rt = new THREE.WebGLRenderTarget(res[0], res[1], { type: THREE.HalfFloatType, samples: 4 });
  const uTex = { value: new THREE.Matrix4() };
  const mat = new THREE.ShaderMaterial({ uniforms: { ...rig.u, tRefl: { value: rt.texture }, uTexMat: uTex, uBase: { value: C(color) }, uPud: { value: puddle }, uRefl: { value: refl }, uSmear: { value: smear }, uSeed: { value: seed }, uMask: { value: mask }, uRipK: { value: ripples } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GLSL_NOISE} ${GLSL_FOG}
      uniform sampler2D tRefl; uniform mat4 uTexMat; uniform vec3 uBase, uKeyDir, uKeyCol, uSky, uGround; uniform float uPud, uRefl, uSmear, uSeed, uMask, uTime, uRipK;
      uniform vec3 uPPos[${MAXP}]; uniform vec3 uPCol[${MAXP}]; uniform float uPRange[${MAXP}]; uniform int uPN; varying vec3 vW;
      void main(){ vec2 xz = vW.xz;
        float pn = fbm2(xz * 0.35 + uSeed) + 0.35 * fbm2(xz * 1.7 + 3.0);
        float pud = smoothstep(1.0 - uPud - 0.02, 1.0 - uPud + 0.02, pn);
        float grit = n2(xz * 18.0) * 0.5 + n2(xz * 55.0) * 0.5;
        vec3 N = vec3(0.0, 1.0, 0.0);
        vec3 amb = mix(uGround, uSky, 0.9);
        vec3 base = uBase * (0.85 + 0.3 * grit) * (1.0 - 0.25 * pud);
        vec3 col = base * (amb + uKeyCol * smoothstep(-0.02, 0.05, uKeyDir.y) * 0.5);
        for (int i = 0; i < ${MAXP}; i++){ if (i >= uPN) break; vec3 L = uPPos[i] - vW; float d = length(L); float a = clamp(1.0 - d / uPRange[i], 0.0, 1.0); a *= a;
          a = floor(a * 4.0 + 0.5 + (grit - 0.5) * 0.6) / 4.0;   // painted light pools (cel steps)
          col += base * uPCol[i] * a * 1.2; }
        vec4 pr = uTexMat * vec4(vW, 1.0); vec2 uv = pr.xy / pr.w;
        float rip = (n2(xz * 6.0 + vec2(0.0, uTime * 0.7)) - 0.5) * 0.004 + (n2(xz * 23.0 - uTime) - 0.5) * 0.003;
        uv.x += rip * (1.5 - pud);
        // raindrop rings: one expanding ring per jittered cell (stronger in puddles)
        vec2 rg = xz * 1.7; vec2 gi = floor(rg); vec2 rd = vec2(0.0); float rr = 0.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 c = gi + vec2(float(i), float(j)); float hh = h12(c * 1.37 + uSeed);
          vec2 o = c + vec2(h12(c + 3.1), h12(c + 7.7)); float ph = fract(uTime * 0.9 + hh); float dist = length(rg - o);
          float ring = exp(-pow((dist - ph * 0.85) * 16.0, 2.0)) * (1.0 - ph) * step(0.35, h12(c + 1.9));
          rr += ring; rd += (rg - o) / max(dist, 1e-3) * ring; }
        uv += rd * 0.006 * (0.3 + pud) * uRipK;
        float sm = mix(0.020, 0.004, pud) * uSmear; vec3 r = vec3(0.0); float ws = 0.0;
        for (int i = -6; i <= 6; i++){ float o = float(i) / 6.0; float wgt = exp(-o * o * 2.5); vec2 q = uv + vec2(rip * 0.5 * float(i), o * sm * 6.0);
          r += texture2D(tRefl, q).rgb * wgt; ws += wgt; }
        r /= ws;
        float V = clamp(normalize(cameraPosition - vW).y, 0.0, 1.0); float fres = 0.12 + 0.88 * pow(1.0 - V, 4.0);
        float k = uRefl * mix(0.35, 1.0, pud) * mix(0.55, 1.0, fres);
        col = mix(col, r, k) + r * k * 0.15 + (r * 0.5 + 0.06) * rr * (0.3 + pud) * 0.5 * uRipK;
        gl_FragColor = vec4(applyFog(col, vW), uMask); }` });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat); mesh.position.y = y;
  const vcam = new THREE.PerspectiveCamera(), TEXB = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const clip = [new THREE.Plane(new V3(0, 1, 0), -y + 0.001)];
  mesh.userData.renderMirror = (renderer, scene, camera, hide = []) => {
    vcam.fov = camera.fov; vcam.aspect = camera.aspect; vcam.near = camera.near; vcam.far = camera.far; vcam.updateProjectionMatrix();
    const dv = new V3(); camera.getWorldDirection(dv); const tg = camera.position.clone().add(dv);
    vcam.position.set(camera.position.x, 2 * y - camera.position.y, camera.position.z); vcam.up.set(0, -1, 0); vcam.lookAt(tg.x, 2 * y - tg.y, tg.z); vcam.updateMatrixWorld();
    uTex.value.copy(TEXB).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
    const vis = [mesh, ...hide].map(o => [o, o.visible]); vis.forEach(([o]) => o.visible = false);
    const prevClip = renderer.clippingPlanes, prevRT = renderer.getRenderTarget(); renderer.clippingPlanes = clip;
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, vcam);
    renderer.clippingPlanes = prevClip; renderer.setRenderTarget(prevRT); vis.forEach(([o, v]) => o.visible = v); };
  return mesh;
}

// =====================================================================================================
// 9. NEON SIGN — canvas tube lettering (white-hot core + coloured tube + soft glow) on a dark board, halo, cel spill
// =====================================================================================================
export function neonSign({ rig, text = 'ラーメン', color = 0xff4fa8, w = 3, h = 1, vertical = false, font = '"Yu Gothic", "Meiryo", "MS Gothic", sans-serif',
  weight = 700, intensity = 3.0, board = 0x14121c, spill = 0.9, range = 7, frame = true, mask = 0.35, haloK = 0.05 } = {}) {
  const col = C(color), hex = '#' + C(color).getHexString(), PX = 256, cw = Math.round(w * PX), ch = Math.round(h * PX);
  const draw = (c, W, H, layer) => { c.clearRect(0, 0, W, H); c.textAlign = 'center'; c.textBaseline = 'middle';
    const n = [...text].length, fs = vertical ? Math.min(W * 0.72, H / n * 0.86) : Math.min(H * 0.62, W / n * 1.05);
    c.font = `${weight} ${fs}px ${font}`; const pts = vertical ? [...text].map((s, i) => [s, W / 2, H * (i + 0.5) / n]) : [[text, W / 2, H / 2]];
    if (frame) { c.strokeStyle = layer === 'core' ? '#fff' : hex; c.lineWidth = layer === 'core' ? 2 : 6; c.shadowColor = hex; c.shadowBlur = layer === 'core' ? 0 : 8; const m = 18; c.beginPath(); c.roundRect(m, m, W - 2 * m, H - 2 * m, 22); c.stroke(); }
    for (const [s, x, y] of pts) { if (layer === 'core') { c.shadowBlur = 0; c.lineWidth = fs * 0.035; c.strokeStyle = '#ffffff'; c.strokeText(s, x, y); }
      else { c.shadowColor = hex; c.shadowBlur = 10; c.lineWidth = fs * 0.10; c.strokeStyle = hex; c.strokeText(s, x, y); } } };   // the glow comes from bloom, not the canvas
  const tube = canvasTex(cw, ch, (c, W, H) => draw(c, W, H, 'tube'), { srgb: true }), core = canvasTex(cw, ch, (c, W, H) => draw(c, W, H, 'core'), { srgb: true });
  const g = new THREE.Group();
  const boardMat = toonMaterial({ rig, color: board, mask, brush: 0.1 });
  const bd = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), boardMat); bd.position.z = -0.07; g.add(bd);
  const lit = addBlend(new THREE.ShaderMaterial({ uniforms: { tT: { value: tube }, tC: { value: core }, uCol: { value: col.clone() }, uK: { value: intensity } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tT, tC; uniform vec3 uCol; uniform float uK; varying vec2 vUv;
      void main(){ vec4 t = texture2D(tT, vUv), c = texture2D(tC, vUv); vec3 o = t.rgb * t.a * uK + mix(uCol, vec3(1.0), 0.6) * c.a * uK * 0.9; gl_FragColor = vec4(o, 1.0); }` }));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lit); face.position.z = 0.002; g.add(face);
  const halo = new THREE.Sprite(addBlend(new THREE.SpriteMaterial({ map: glowTexture(), color: col.clone().multiplyScalar(haloK * intensity) }))); halo.scale.set(w * 1.6 + 1, h * 1.35 + 1, 1); halo.position.z = 0.3; g.add(halo);
  const point = rig.addPoint({ pos: g, offset: null, color: col, intensity: spill, range });
  g.userData = { point, mat: lit, halo, base: intensity, baseSpill: spill };
  g.set = (k) => { lit.uniforms.uK.value = intensity * k; halo.material.color.copy(col).multiplyScalar(haloK * intensity * k); point.intensity = spill * k; };
  g.updatePoint = () => { point.offset = new V3(0, 0, 0.8).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion())); };
  return g;
}

// =====================================================================================================
// 10. POST — EffectComposer: render (MSAA) -> gouache paint (Kuwahara, alpha mask) -> screen-space god rays ->
//     UnrealBloom -> grade (halation, chromatic softness, tone knee, sat, split tone, vignette, paper, grain, sRGB)
// =====================================================================================================
// --- PAINT PASS: structure tensor -> anisotropic Kuwahara (Kyprianidis 2009/2011, polynomial weights) following image
// structure, + brush strokes (line integral of noise along the stroke direction), wobbly painted edges (domain warp),
// hue / value variation inside flat cel bands, paper fibres. Applied by the ALPHA mask only (Clawd, ink, FX stay crisp).
const FSQ_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TENSOR_FS = `uniform sampler2D tDiffuse; uniform vec2 uRes; varying vec2 vUv;
  vec3 T(float x, float y){ vec3 c = texture2D(tDiffuse, vUv + vec2(x, y) / uRes).rgb; return c / (1.0 + c); }
  void main(){ vec3 sx = (T(-1.,-1.) + 2.0 * T(-1.,0.) + T(-1.,1.) - T(1.,-1.) - 2.0 * T(1.,0.) - T(1.,1.)) * 0.25;
    vec3 sy = (T(-1.,-1.) + 2.0 * T(0.,-1.) + T(1.,-1.) - T(-1.,1.) - 2.0 * T(0.,1.) - T(1.,1.)) * 0.25;
    gl_FragColor = vec4(dot(sx, sx), dot(sy, sy), dot(sx, sy), 1.0); }`;
const TBLUR_FS = `uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
  void main(){ vec4 c = vec4(0.0); float ws = 0.0; for (int i = -6; i <= 6; i++){ float w = exp(-float(i * i) / 18.0); c += texture2D(tDiffuse, vUv + uDir * float(i)) * w; ws += w; } gl_FragColor = c / ws; }`;
const AKF_FS = `${GLSL_NOISE} uniform sampler2D tDiffuse, tT; uniform vec2 uRes; uniform float uK, uQ, uHard, uRad, uAlpha, uStroke, uStrokeL, uWob, uVary, uHue, uPaper;
  // film 27: WORLD-ANCHORED paint texture. With uAnchor = 1 every noise of the pass (wobble, strokes, pigment, paper)
  // is evaluated at the world point under the pixel (depth of the scene capture + inverse view-projection), at a
  // screen-stable size (two world-space octaves blended by log2 of the pixel footprint) -> the brush texture sticks to
  // the walls / sky as the camera moves instead of sliding like a screen overlay. Sky = anchored to the view direction.
  uniform sampler2D tDepth; uniform mat4 uInvVP; uniform vec3 uCamPos, uCamR, uCamU; uniform float uPixA, uAnchor;
  vec3 gP; float gPW;
  float an(vec3 Q, float pxs, float seed){ float L = log2(max(pxs * gPW, 1e-6)), l0 = floor(L), f = L - l0;
    return mix(n3(Q / exp2(l0) + seed), n3(Q / exp2(l0 + 1.0) + seed + 31.7), f); }
  varying vec2 vUv;
  vec3 hueRot(vec3 c, float a){ const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703); vec3 y = toYIQ * c; float h = atan(y.z, y.y) + a, ch = length(y.yz); return toRGB * vec3(y.x, ch * cos(h), ch * sin(h)); }
  void main(){ vec4 c0 = texture2D(tDiffuse, vUv); float mk = clamp(c0.a, 0.0, 1.0) * uK;
    if (mk < 0.01) { gl_FragColor = c0; return; }
    vec2 px = gl_FragCoord.xy;
    bool AN = uAnchor > 0.5;
    if (AN) { float z = texture2D(tDepth, vUv).x; vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); gP = w.xyz / w.w;
      float dd = length(gP - uCamPos); if (z > 0.99999 || dd > 600.0) { gP = uCamPos + normalize(gP - uCamPos) * 300.0; dd = 300.0; } gPW = dd * uPixA; }
    // wobbly painted edges: warp where we read the picture
    vec2 wob = AN ? (vec2(an(gP, 23.0, 0.0), an(gP, 23.0, 17.3)) - 0.5) * 2.0 * uWob + (vec2(an(gP, 6.0, 3.0), an(gP, 6.0, 9.0)) - 0.5) * uWob * 0.6
                  : (vec2(n2(px / 23.0), n2(px / 23.0 + 17.3)) - 0.5) * 2.0 * uWob + (vec2(n2(px / 6.0 + 3.0), n2(px / 6.0 + 9.0)) - 0.5) * uWob * 0.6;
    vec2 uv = vUv + wob / uRes;
    vec3 g = texture2D(tT, uv).xyz; float E = g.x, G = g.y, F = g.z;
    float dd = sqrt(max((E - G) * (E - G) + 4.0 * F * F, 0.0)); float l1 = 0.5 * (E + G + dd), l2 = 0.5 * (E + G - dd);
    vec2 tv = vec2(l1 - E, -F); vec2 t = length(tv) > 1e-7 ? normalize(tv) : vec2(0.0, 1.0);
    float phi = -atan(t.y, t.x), A = (l1 + l2 > 1e-7) ? (l1 - l2) / (l1 + l2) : 0.0;
    float a = uRad * clamp((uAlpha + A) / uAlpha, 0.1, 2.0), b = uRad * clamp(uAlpha / (uAlpha + A), 0.1, 2.0);
    float cp = cos(phi), sp = sin(phi); mat2 SR = mat2(0.5 / a, 0.0, 0.0, 0.5 / b) * mat2(cp, sp, -sp, cp);
    float mx = sqrt(a * a * cp * cp + b * b * sp * sp), my = sqrt(a * a * sp * sp + b * b * cp * cp);
    vec4 m[8]; vec3 s[8]; for (int k = 0; k < 8; k++){ m[k] = vec4(0.0); s[k] = vec3(0.0); }
    float zeta = 2.0 / uRad, zc = 0.58, sz = sin(zc), eta = (zeta + cos(zc)) / (sz * sz);
    const int R = 10;
    for (int j = -R; j <= R; j++){ if (abs(float(j)) > my) continue;
      for (int i = -R; i <= R; i++){ if (abs(float(i)) > mx) continue;
        vec2 v = SR * vec2(float(i), float(j)); if (dot(v, v) > 0.25) continue;
        vec3 c = texture2D(tDiffuse, uv + vec2(float(i), float(j)) / uRes).rgb; c = c / (1.0 + c);
        float w[8]; float sum = 0.0, z, vxx, vyy;
        vxx = zeta - eta * v.x * v.x; vyy = zeta - eta * v.y * v.y;
        z = max(0.0, v.y + vxx); w[0] = z * z; z = max(0.0, -v.x + vyy); w[2] = z * z; z = max(0.0, -v.y + vxx); w[4] = z * z; z = max(0.0, v.x + vyy); w[6] = z * z;
        vec2 u = 0.70710678 * vec2(v.x - v.y, v.x + v.y); vxx = zeta - eta * u.x * u.x; vyy = zeta - eta * u.y * u.y;
        z = max(0.0, u.y + vxx); w[1] = z * z; z = max(0.0, -u.x + vyy); w[3] = z * z; z = max(0.0, -u.y + vxx); w[5] = z * z; z = max(0.0, u.x + vyy); w[7] = z * z;
        for (int k = 0; k < 8; k++) sum += w[k];
        float gw = exp(-3.125 * dot(v, v)) / max(sum, 1e-5);
        for (int k = 0; k < 8; k++){ float wk = w[k] * gw; m[k] += vec4(c * wk, wk); s[k] += c * c * wk; } } }
    vec4 o = vec4(0.0);
    for (int k = 0; k < 8; k++){ vec3 mu = m[k].rgb / max(m[k].w, 1e-5); vec3 sg = abs(s[k] / max(m[k].w, 1e-5) - mu * mu);
      float sig = sg.r + sg.g + sg.b; float wk = 1.0 / (1.0 + pow(uHard * 1000.0 * sig, 0.5 * uQ)); o += vec4(mu * wk, wk); }
    vec3 pc = o.rgb / max(o.w, 1e-5);
    // brush strokes: noise integrated along the local stroke direction t (strokes follow edges, cross-hatch in flats)
    float stroke, region, vv, hh, fib, pap;
    if (AN) {
      vec2 sd = (A > 0.15) ? t : normalize(vec2(1.0, 0.35 + 0.6 * (an(gP, 90.0, 5.0) - 0.5)));
      vec3 D = (uCamR * sd.x + uCamU * sd.y) * gPW * uStrokeL;
      float acc = 0.0; for (int k = -7; k <= 7; k++) acc += an(gP + D * float(k), 2.2, 1.3);
      stroke = (acc / 15.0 - 0.5) * 2.0;
      region = 0.6 + 0.8 * an(gP, 140.0, 2.1);
      vv = an(gP, 160.0, 4.4) * 0.62 + an(gP, 70.0, 6.6) * 0.38 - 0.5; hh = an(gP, 260.0, 11.0) * 0.62 + an(gP, 110.0, 12.5) * 0.38 - 0.5;
      fib = an(gP * vec3(1.0, 0.1, 1.0), 1.4, 21.0) * an(gP * vec3(0.1, 1.0, 0.1), 1.4, 27.0);
      pap = an(gP, 9.0, 33.0) * 0.6 + an(gP, 4.0, 35.0) * 0.4 - 0.5;
    } else {
      vec2 sd = (A > 0.15) ? t : normalize(vec2(1.0, 0.35 + 0.6 * (n2(px / 90.0) - 0.5)));
      float acc = 0.0; for (int k = -7; k <= 7; k++) acc += n2((px + sd * float(k) * uStrokeL) / 2.2);
      stroke = (acc / 15.0 - 0.5) * 2.0; region = 0.6 + 0.8 * n2(px / 140.0);
      vv = fbm2(px / 160.0) - 0.5; hh = fbm2(px / 260.0 + 11.0) - 0.5;
      fib = n2(vec2(px.x / 1.3, px.y / 14.0)) * n2(vec2(px.x / 16.0, px.y / 1.4)); pap = fbm2(px / 9.0) - 0.5;
    }
    pc *= 1.0 + stroke * uStroke * region;
    // pigment variation inside flat bands (value + slight hue drift), paper fibres
    pc *= 1.0 + vv * uVary; pc = max(hueRot(pc, hh * uHue), 0.0);
    pc *= 1.0 + (pap * 0.6 + (fib - 0.25) * 0.5) * uPaper;
    pc = pc / max(vec3(1.0) - pc, vec3(1e-4));
    gl_FragColor = vec4(mix(c0.rgb, pc, mk), c0.a); }`;
export class PaintPass extends Pass {
  constructor(width = 1920, height = 1080) {
    super(); this.needsSwap = true; const res = new THREE.Vector2(width, height);
    const RT = () => new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false });
    this.t1 = RT(); this.t2 = RT();
    this.tensor = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uRes: { value: res } }, vertexShader: FSQ_VS, fragmentShader: TENSOR_FS });
    this.blur = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: FSQ_VS, fragmentShader: TBLUR_FS });
    this.uniforms = { tDiffuse: { value: null }, tT: { value: null }, uRes: { value: res }, uK: { value: 1 }, uQ: { value: 8 }, uHard: { value: 1 }, uRad: { value: 5 }, uAlpha: { value: 1 },
      uStroke: { value: 0.07 }, uStrokeL: { value: 1.6 }, uWob: { value: 2.0 }, uVary: { value: 0.10 }, uHue: { value: 0.12 }, uPaper: { value: 0.05 },
      tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uCamR: { value: new THREE.Vector3(1, 0, 0) }, uCamU: { value: new THREE.Vector3(0, 1, 0) }, uPixA: { value: 0.001 }, uAnchor: { value: 0 } };
    this.akf = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: FSQ_VS, fragmentShader: AKF_FS });
    this.fsq = new FullScreenQuad(null); this.res = res;
  }
  setSize(w, h) { this.t1.setSize(w, h); this.t2.setSize(w, h); this.res.set(w, h); }
  // film 27: anchor the paint texture to the world (depth = DepthTexture of a capture rendered with the same camera)
  setAnchor(depthTex, camera) { const U = this.uniforms; if (!depthTex) { U.uAnchor.value = 0; return; }
    camera.updateMatrixWorld(); U.tDepth.value = depthTex; U.uAnchor.value = 1;
    U.uInvVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert(); camera.getWorldPosition(U.uCamPos.value);
    U.uCamR.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); U.uCamU.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    U.uPixA.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 40) / 2) / this.res.y; }
  render(renderer, writeBuffer, readBuffer) {
    const q = this.fsq; q.material = this.tensor; this.tensor.uniforms.tDiffuse.value = readBuffer.texture; renderer.setRenderTarget(this.t1); q.render(renderer);
    q.material = this.blur; this.blur.uniforms.tDiffuse.value = this.t1.texture; this.blur.uniforms.uDir.value.set(1 / this.res.x, 0); renderer.setRenderTarget(this.t2); q.render(renderer);
    this.blur.uniforms.tDiffuse.value = this.t2.texture; this.blur.uniforms.uDir.value.set(0, 1 / this.res.y); renderer.setRenderTarget(this.t1); q.render(renderer);
    q.material = this.akf; this.uniforms.tDiffuse.value = readBuffer.texture; this.uniforms.tT.value = this.t1.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); q.render(renderer);
  }
}

const RAYS_SHADER = { uniforms: { tDiffuse: { value: null }, uLight: { value: new THREE.Vector2(0.5, 0.5) }, uOn: { value: 0 }, uK: { value: 0.6 }, uDecay: { value: 0.965 }, uDen: { value: 0.9 },
    uThr: { value: 0.6 }, uRad: { value: 0.35 }, uTint: { value: new THREE.Color(1, 0.85, 0.6) }, uAsp: { value: 16 / 9 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uLight; uniform float uOn, uK, uDecay, uDen, uThr, uRad, uAsp; uniform vec3 uTint; varying vec2 vUv;
  float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main(){ vec4 c0 = texture2D(tDiffuse, vUv); if (uOn < 0.5) { gl_FragColor = c0; return; }
    const int N = 64; vec2 d = (vUv - uLight) * uDen / float(N); vec2 uv = vUv - d * h12(gl_FragCoord.xy); float ill = 1.0; vec3 acc = vec3(0.0);
    for (int i = 0; i < N; i++){ uv -= d; vec3 s = texture2D(tDiffuse, uv).rgb; float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
      float m = 1.0 - smoothstep(0.0, uRad, length((uv - uLight) * vec2(uAsp, 1.0)));
      acc += s * (max(l - uThr, 0.0) / max(l, 1e-4)) * m * ill; ill *= uDecay; }
    gl_FragColor = vec4(c0.rgb + acc * uTint * uK / float(N) * 4.0, c0.a); }` };

const GRADE_SHADER = { uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1920, 1080) }, uExpo: { value: 1 }, uSat: { value: 1.05 }, uKnee: { value: 0.72 },
    uHal: { value: 0.18 }, uHalThr: { value: 0.8 }, uHalCol: { value: new THREE.Color(1.0, 0.35, 0.15) }, uCA: { value: 0.9 }, uVig: { value: 0.28 }, uGrain: { value: 0.035 }, uPaper: { value: 0.05 },
    uLift: { value: new THREE.Color(0.012, 0.010, 0.022) }, uShTint: { value: new THREE.Color(0.94, 0.97, 1.06) }, uHiTint: { value: new THREE.Color(1.04, 1.0, 0.94) }, uGamma: { value: 1.0 }, uSeed: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `${GLSL_NOISE} uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uExpo, uSat, uKnee, uHal, uHalThr, uCA, uVig, uGrain, uPaper, uGamma, uSeed;
  uniform vec3 uHalCol, uLift, uShTint, uHiTint; varying vec2 vUv;
  vec3 knee(vec3 c){ vec3 k = vec3(uKnee); return mix(c, k + (1.0 - k) * (1.0 - exp(-(c - k) / (1.0 - k))), step(k, c)); }
  vec3 srgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  void main(){ vec2 q = vUv - 0.5; vec2 ca = q * uCA / uRes * 2.0 * length(q * 2.0);
    vec3 c = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
    // halation: warm-red fringe around bright cores (two rings of taps on the thresholded image)
    vec3 h = vec3(0.0); for (int i = 0; i < 12; i++){ float a = float(i) * 0.5236; vec2 o = vec2(cos(a), sin(a));
      vec3 s1 = texture2D(tDiffuse, vUv + o * 4.0 / uRes).rgb, s2 = texture2D(tDiffuse, vUv + o * 10.0 / uRes).rgb;
      h += max(s1 - uHalThr, 0.0) * 0.6 + max(s2 - uHalThr, 0.0) * 0.4; }
    c += dot(h / 12.0, vec3(0.3, 0.5, 0.2)) * uHalCol * uHal;
    c *= uExpo; c = knee(max(c, 0.0));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(mix(vec3(l), c, uSat), 0.0);
    c *= mix(uShTint, uHiTint, smoothstep(0.05, 0.6, l)); c += uLift * (1.0 - smoothstep(0.0, 0.4, l));
    c = pow(max(c, 0.0), vec3(uGamma));
    c *= 1.0 - uVig * smoothstep(0.15, 0.85, length(q * vec2(1.0, 0.8)) * 1.25);
    vec2 pp = vUv * uRes / 1080.0 * 9.0; float paper = (fbm2(pp * 6.0) - 0.5) + (n2(vec2(pp.x * 140.0, pp.y * 9.0)) * n2(vec2(pp.x * 18.0, pp.y * 170.0)) - 0.25) * 0.7;
    c *= 1.0 + paper * uPaper;
    vec3 o = srgb(c);
    float gr = (h12(gl_FragCoord.xy + uSeed * 17.0) + h12(gl_FragCoord.xy * 1.37 + uSeed * 31.0) - 1.0);
    o += gr * uGrain * (0.6 + 0.8 * (1.0 - abs(l - 0.45) * 1.6));
    gl_FragColor = vec4(o, 1.0); }` };

export function createAnimeRenderer({ width = 1920, height = 1080, samples = 4, canvas = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvas || undefined, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false); renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 1); renderer.localClippingEnabled = false;
  const post = new AnimePost(renderer, { width, height, samples });
  return { renderer, post, canvas: renderer.domElement };
}

export class AnimePost {
  constructor(renderer, { width = 1920, height = 1080, samples = 4 } = {}) {
    this.renderer = renderer; this.w = width; this.h = height;
    const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt); this.composer.setPixelRatio(1); this.composer.setSize(width, height);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.Camera()); this.renderPass.clearAlpha = 1;
    this.paint = new PaintPass(width, height);
    this.rays = new ShaderPass(RAYS_SHADER); this.rays.uniforms.uAsp.value = width / height;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.55, 0.55, 0.9);
    this.grade = new ShaderPass(GRADE_SHADER); this.grade.uniforms.uRes.value.set(width, height);
    for (const p of [this.renderPass, this.paint, this.rays, this.bloom, this.grade]) this.composer.addPass(p);
    this.before = [];   // callbacks (renderer, scene, camera) run before the main pass (mirrors)
    this.set(AnimePost.DEFAULTS);
  }
  // s = { expo, sat, knee, gamma, vignette, grain, paper, halation, ca, lift, shTint, hiTint,
  //       paint: { k, radius, q, hard }, bloom: { strength, radius, threshold }, rays: { on, pos(V3 world), k, decay, density, thr, radius, tint } }
  set(s = {}) { const G = this.grade.uniforms, P = this.paint.uniforms, R = this.rays.uniforms;
    if (s.expo != null) G.uExpo.value = s.expo; if (s.sat != null) G.uSat.value = s.sat; if (s.knee != null) G.uKnee.value = s.knee; if (s.gamma != null) G.uGamma.value = s.gamma;
    if (s.vignette != null) G.uVig.value = s.vignette; if (s.grain != null) G.uGrain.value = s.grain; if (s.paper != null) G.uPaper.value = s.paper;
    if (s.halation != null) G.uHal.value = s.halation; if (s.halThr != null) G.uHalThr.value = s.halThr; if (s.ca != null) G.uCA.value = s.ca;
    if (s.lift != null) G.uLift.value.copy(C(s.lift)); if (s.shTint != null) G.uShTint.value.copy(C(s.shTint)); if (s.hiTint != null) G.uHiTint.value.copy(C(s.hiTint));
    if (s.halCol != null) G.uHalCol.value.copy(C(s.halCol));
    if (s.paint) { const p = s.paint, map = { k: 'uK', radius: 'uRad', q: 'uQ', hard: 'uHard', aniso: 'uAlpha', stroke: 'uStroke', strokeLen: 'uStrokeL', wobble: 'uWob', vary: 'uVary', hue: 'uHue', paper: 'uPaper' };
      for (const [k, u] of Object.entries(map)) if (p[k] != null) P[u].value = k === 'radius' ? Math.min(5, p[k]) : p[k]; this.paint.enabled = P.uK.value > 0; }
    if (s.bloom) { const b = s.bloom; if (b.strength != null) this.bloom.strength = b.strength; if (b.radius != null) this.bloom.radius = b.radius; if (b.threshold != null) this.bloom.threshold = b.threshold; }
    if (s.rays) { const r = s.rays; this.raysPos = r.pos ?? this.raysPos; if (r.on != null) R.uOn.value = r.on ? 1 : 0; if (r.k != null) R.uK.value = r.k; if (r.decay != null) R.uDecay.value = r.decay;
      if (r.density != null) R.uDen.value = r.density; if (r.thr != null) R.uThr.value = r.thr; if (r.radius != null) R.uRad.value = r.radius; if (r.tint != null) R.uTint.value.copy(C(r.tint)); }
    return this; }
  render(scene, camera, time = 0) {
    scene.userData.time = time; this.grade.uniforms.uSeed.value = Math.round(time * 24) % 997;
    for (const f of this.before) f(this.renderer, scene, camera);
    if (this.rays.uniforms.uOn.value > 0.5 && this.raysPos) { const p = this.raysPos.clone().project(camera); this.rays.uniforms.uLight.value.set((p.x + 1) / 2, (p.y + 1) / 2); }
    this.renderPass.scene = scene; this.renderPass.camera = camera; this.composer.render();
  }
}
AnimePost.DEFAULTS = { expo: 1, sat: 1.05, knee: 0.72, gamma: 1, vignette: 0.28, grain: 0.03, paper: 0.05, halation: 0.18, ca: 0.9,
  paint: { k: 1, radius: 4, q: 8, hard: 1, aniso: 1, stroke: 0.07, strokeLen: 1.6, wobble: 2.0, vary: 0.10, hue: 0.12, paper: 0.05 }, bloom: { strength: 0.55, radius: 0.55, threshold: 0.9 }, rays: { on: false } };

// =====================================================================================================
// 11. END CARD — "Fable 5.5" brush lettering drawn stroke by stroke (procedural brush, no fonts) + red hanko 寓話
//     + optional film title EN / JP. createEndCard() -> { scene, camera, draw(t), duration }.
// =====================================================================================================
// glyph strokes in a 1000 x 300 box (y down, baseline 250, x-height 140), italic shear applied at draw time; w = width scale
const FABLE_STROKES = [
  { p: [[118, 60], [113, 110], [104, 175], [94, 252]], w: 1.0 },                                   // F stem
  { p: [[66, 66], [110, 58], [160, 52], [214, 40]], w: 0.85 },                                     // F top bar
  { p: [[92, 150], [124, 147], [166, 141]], w: 0.75 },                                             // F middle bar
  { p: [[302, 166], [284, 145], [250, 146], [224, 178], [221, 222], [240, 250], [270, 240], [296, 200]], w: 0.85 },  // a bowl
  { p: [[306, 146], [300, 196], [301, 236], [322, 252]], w: 0.9 },                                 // a stem
  { p: [[376, 40], [368, 120], [360, 196], [355, 250]], w: 1.0 },                                  // b stem
  { p: [[361, 196], [388, 156], [424, 158], [432, 202], [413, 240], [377, 252], [357, 242]], w: 0.85 },  // b bowl
  { p: [[484, 38], [476, 128], [469, 206], [478, 244], [500, 250]], w: 0.95 },                     // l
  { p: [[528, 204], [566, 198], [592, 178], [582, 151], [550, 148], [522, 176], [516, 220], [534, 248], [570, 252], [602, 232]], w: 0.85 },  // e
  { p: [[726, 60], [760, 57], [806, 52]], w: 0.8 },                                                // 5 top bar
  { p: [[727, 62], [721, 102], [714, 142], [742, 131], [781, 137], [806, 170], [800, 220], [768, 250], [727, 251], [700, 233]], w: 1.0 },  // 5 body
  { p: [[842, 238], [849, 246]], w: 1.5, dot: true },                                              // .
  { p: [[896, 60], [930, 57], [976, 52]], w: 0.8 },                                                // 5 top bar
  { p: [[897, 62], [891, 102], [884, 142], [912, 131], [951, 137], [976, 170], [970, 220], [938, 250], [897, 251], [870, 233]], w: 1.0 },  // 5 body
];
function catmull(pts, step = 1.2) {
  const out = []; const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) { const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]]; const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(2, Math.ceil(L / step));
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; out.push([0, 1].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); } }
  out.push(pts[pts.length - 1].slice()); return out;
}
export function brushLettering({ strokes = FABLE_STROKES, x0 = 0, y0 = 0, scale = 1, shear = 0.16, width = 26, nibA = -0.62, ink = [26, 18, 14], dur = 2.6, gap = 0.07, seed = 5 } = {}) {
  const R = rng(seed), S = strokes.map(s => { const pts = catmull(s.p.map(([x, y]) => [x0 + (x + (250 - y) * shear) * scale, y0 + y * scale]), 1.0);
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return { ...s, pts, L, seedB: Array.from({ length: 22 }, () => R()) }; });
  const tot = S.reduce((a, s) => a + Math.pow(s.L + 40, 0.75), 0), avail = dur - gap * (S.length - 1); let t = 0;
  for (const s of S) { s.t0 = t; s.d = avail * Math.pow(s.L + 40, 0.75) / tot; t += s.d + gap; }
  const hash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  function drawStroke(c, s, f) {
    const n = s.pts.length, upto = Math.floor(n * Math.min(1, f)), NB = 18, W = width * scale * s.w;
    if (s.dot) { if (f <= 0) return; const [x, y] = s.pts[0], r = W * 0.75 * Math.min(1, f * 2); c.fillStyle = `rgba(${ink},0.92)`; c.beginPath(); c.ellipse(x + 2, y, r * 1.1, r * 0.95, -0.5, 0, Math.PI * 2); c.fill(); return; }
    for (let b = 0; b < NB; b++) { const o = b / (NB - 1) - 0.5, sb = s.seedB[b % 22]; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = W / NB * 2.1 * (0.7 + 0.6 * sb);
      let prev = null;
      for (let i = 1; i < upto; i++) { const u = i / (n - 1), p = s.pts[i], q = s.pts[i - 1];
        const press = THREE.MathUtils.smoothstep(u, 0, 0.07) * (1 - 0.72 * THREE.MathUtils.smoothstep(u, 0.62, 1.0)) * (0.92 + 0.08 * Math.sin(u * 9 + sb * 6)) + 0.12 * (1 - THREE.MathUtils.smoothstep(u, 0, 0.12));
        const dx = p[0] - q[0], dy = p[1] - q[1], dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
        const nib = 0.3 + 0.85 * Math.abs(Math.sin(Math.atan2(dy, dx) - nibA));   // broad-nib brush: thick downstrokes, hairline up-right
        const w = W * press * nib;
        const dry = 0.08 + 0.55 * THREE.MathUtils.smoothstep(u, 0.7, 1.0) * (0.4 + Math.abs(o) * 1.6) + 0.25 * Math.abs(o) * Math.abs(o) * 4 * 0.3;
        const gapOn = hash(b + sb * 10, Math.floor(i / (5 + sb * 6))) < dry;
        const a = 0.9 - 0.2 * u;
        const pt = [p[0] + nx * o * w, p[1] + ny * o * w];
        if (!gapOn && prev) { c.strokeStyle = `rgba(${ink},${a.toFixed(3)})`; c.beginPath(); c.moveTo(prev[0], prev[1]); c.lineTo(pt[0], pt[1]); c.stroke(); }
        prev = pt; } }
  }
  return { strokes: S, duration: t - gap,
    draw(c, time) { for (const s of S) { if (time <= s.t0) break; drawStroke(c, s, (time - s.t0) / s.d); } } };
}
// red hanko seal with 寓話 knocked out (system mincho font via canvas), rough stamped edges
export function drawHanko(c, { x, y, size = 96, text = '寓話', color = '#c1272d', alpha = 1, rot = -0.04, seed = 9, font = '"Yu Mincho", "MS Mincho", "Noto Serif JP", serif' } = {}) {
  const R = rng(seed), s = size, off = document.createElement('canvas'); off.width = off.height = Math.ceil(s * 1.3); const o = off.getContext('2d'), m = s * 0.15;
  o.fillStyle = color; o.beginPath(); const N = 40; for (let i = 0; i <= N * 4; i++) { const k = i / N, side = Math.floor(k) % 4, f = k - Math.floor(k), j = (R() - 0.5) * s * 0.025;
    const pts = [[m + f * s, m + j], [m + s + j, m + f * s], [m + s - f * s, m + s + j], [m + j, m + s - f * s]][side]; if (i === 0) o.moveTo(...pts); else o.lineTo(...pts); } o.closePath(); o.fill();
  o.globalCompositeOperation = 'destination-out'; o.lineWidth = s * 0.035; o.strokeStyle = '#000'; o.strokeRect(m + s * 0.08, m + s * 0.08, s * 0.84, s * 0.84);
  o.font = `700 ${s * 0.38}px ${font}`; o.textAlign = 'center'; o.textBaseline = 'middle'; const ch = [...text]; ch.forEach((t, i) => o.fillText(t, m + s / 2, m + s * (0.29 + 0.43 * i)));
  for (let i = 0; i < 260; i++) { o.globalAlpha = 0.3 + 0.7 * R(); o.beginPath(); o.arc(m + R() * s, m + R() * s, R() * s * 0.012 + 0.3, 0, Math.PI * 2); o.fill(); }
  o.globalAlpha = 1; o.globalCompositeOperation = 'source-over';
  c.save(); c.globalAlpha = alpha; c.translate(x, y); c.rotate(rot); c.drawImage(off, -off.width / 2, -off.height / 2); c.restore();
}
export function createEndCard({ width = 1920, height = 1080, title = null, titleJP = null, paper = 0xF1E6CF, scale = 0.95, seal = true, bg = null } = {}) {
  const cw = width, ch = height, canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch; const c = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  const W = 1000 * scale, x0 = (cw - W) / 2 - 30 * scale, y0 = ch * 0.5 - 175 * scale - (title ? 40 : 0);
  const lettering = brushLettering({ x0, y0, scale });
  const tSeal = lettering.duration + 0.25, tTitle = tSeal + 0.45, duration = tTitle + 1.2;
  const pc = C(paper), base = `rgb(${Math.round(pc.r ** (1 / 2.2) * 255)},${Math.round(pc.g ** (1 / 2.2) * 255)},${Math.round(pc.b ** (1 / 2.2) * 255)})`;
  const paperLayer = document.createElement('canvas'); paperLayer.width = cw; paperLayer.height = ch; { const p = paperLayer.getContext('2d'); const R = rng(4);
    p.fillStyle = base; p.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 2600; i++) { p.strokeStyle = `rgba(${R() < 0.5 ? '120,90,60' : '255,250,240'},${(0.03 + 0.05 * R()).toFixed(3)})`; p.lineWidth = 0.6 + R() * 1.2; const x = R() * cw, y = R() * ch, a = R() * Math.PI, l = 6 + R() * 26;
      p.beginPath(); p.moveTo(x, y); p.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (R() - 0.5) * 6, y + Math.sin(a) * l * 0.5 + (R() - 0.5) * 6, x + Math.cos(a) * l, y + Math.sin(a) * l); p.stroke(); }
    const g = p.createRadialGradient(cw / 2, ch / 2, ch * 0.3, cw / 2, ch / 2, ch * 0.95); g.addColorStop(0, 'rgba(90,60,30,0)'); g.addColorStop(1, 'rgba(90,60,30,0.22)'); p.fillStyle = g; p.fillRect(0, 0, cw, ch); }
  function draw(t) {
    c.clearRect(0, 0, cw, ch); if (bg) c.drawImage(bg, 0, 0, cw, ch); else c.drawImage(paperLayer, 0, 0);
    lettering.draw(c, t);
    if (seal && t > tSeal) { const k = Math.min(1, (t - tSeal) / 0.18), pop = 1 + 0.35 * (1 - k) * (1 - k);
      drawHanko(c, { x: x0 + 1020 * scale + 70 * scale, y: y0 + 105 * scale, size: 92 * scale * pop, alpha: Math.min(1, k * 1.4) }); }
    if ((title || titleJP) && t > tTitle) { const a = Math.min(1, (t - tTitle) / 0.6); c.save(); c.globalAlpha = a * 0.82; c.fillStyle = 'rgb(40,28,22)'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const ty = y0 + 330 * scale; c.font = `italic 400 ${36 * scale}px Georgia, "Times New Roman", serif`; const parts = [];
      if (title) parts.push(['en', title]); if (titleJP) parts.push(['jp', titleJP]);
      const gapW = 46 * scale; c.font = `italic 400 ${36 * scale}px Georgia, serif`; const wEn = title ? c.measureText(title).width : 0; c.font = `500 ${34 * scale}px "Yu Mincho", "MS Mincho", serif`; const wJp = titleJP ? c.measureText(titleJP).width + 12 : 0;
      const totW = wEn + wJp + (title && titleJP ? gapW : 0); let x = cw / 2 - totW / 2;
      if (title) { c.font = `italic 400 ${36 * scale}px Georgia, serif`; c.textAlign = 'left'; c.fillText(title, x, ty); x += wEn; }
      if (title && titleJP) { c.fillRect(x + gapW * 0.3, ty, gapW * 0.4, 1.6 * scale); x += gapW; }
      if (titleJP) { c.font = `500 ${34 * scale}px "Yu Mincho", "MS Mincho", serif`; c.textAlign = 'left'; c.fillText(titleJP, x + 6, ty); }
      c.restore(); }
    tex.needsUpdate = true;
  }
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  const mat = new THREE.ShaderMaterial({ uniforms: { t: { value: tex } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 0.0); }`, depthTest: false, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  return { scene, camera, canvas, texture: tex, draw, duration, tSeal, tTitle, lettering };
}
// grade for the end card (paper must stay paper): no paint pass, low bloom, warm, soft grain
export const END_CARD_POST = { expo: 1.0, sat: 1.0, knee: 0.9, vignette: 0.12, grain: 0.025, paper: 0.0, halation: 0.0, ca: 0.4, lift: 0x000000, shTint: 0xffffff, hiTint: 0xffffff,
  paint: { k: 0 }, bloom: { strength: 0.0, radius: 0.3, threshold: 1.5 }, rays: { on: false } };

// =====================================================================================================
// 12. MEASURE — Clawd body hue / sat from the rendered canvas (area-weighted surface samples, face plate excluded)
// =====================================================================================================
export function bodySamples(mesh, n = 600, seed = 3) {
  const g = mesh.geometry, pos = g.getAttribute('position'), nor = g.getAttribute('normal'), idx = g.index, R = rng(seed), tris = [], A = [];
  const tri = (i) => idx ? [idx.getX(i * 3), idx.getX(i * 3 + 1), idx.getX(i * 3 + 2)] : [i * 3, i * 3 + 1, i * 3 + 2];
  const nT = (idx ? idx.count : pos.count) / 3; let acc = 0; const a = new V3(), b = new V3(), c = new V3();
  for (let i = 0; i < nT; i++) { const [i0, i1, i2] = tri(i); a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    acc += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2; A.push(acc); tris.push([i0, i1, i2]); }
  const out = [];
  for (let k = 0; k < n; k++) { const r = R() * acc; let lo = 0, hi = A.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (A[m] < r) lo = m + 1; else hi = m; }
    const [i0, i1, i2] = tris[lo]; let u = R(), v = R(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const p = new V3().fromBufferAttribute(pos, i0).multiplyScalar(1 - u - v).addScaledVector(new V3().fromBufferAttribute(pos, i1), u).addScaledVector(new V3().fromBufferAttribute(pos, i2), v);
    const nn = new V3().fromBufferAttribute(nor, i0).multiplyScalar(1 - u - v).addScaledVector(new V3().fromBufferAttribute(nor, i1), u).addScaledVector(new V3().fromBufferAttribute(nor, i2), v).normalize();
    out.push({ p, n: nn }); }
  return out;
}
export function measureBody(canvas, camera, mesh, { faceExclude = true, samples = null } = {}) {
  const S = samples || (mesh.userData._samples ||= bodySamples(mesh));
  const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height; const x = c2.getContext('2d'); x.drawImage(canvas, 0, 0);
  const W = canvas.width, H = canvas.height, data = x.getImageData(0, 0, W, H).data, hs = [], ss = [], vs = [];
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  // the face plate = front face (+Z) near the centre: |x| < 0.36, -0.24 < y - cy < 0.28 in body-local units
  mesh.geometry.computeBoundingBox(); const bb = mesh.geometry.boundingBox, cy = (bb.min.y + bb.max.y) / 2, sx = (bb.max.x - bb.min.x);
  for (const s of S) {
    if (faceExclude && s.n.z > 0.6 && Math.abs(s.p.x) < 0.36 * sx && s.p.y - cy > -0.26 * sx && s.p.y - cy < 0.3 * sx) continue;
    const w = s.p.clone().applyMatrix4(mesh.matrixWorld), n = s.n.clone().applyMatrix3(nm).normalize();
    if (n.dot(camera.position.clone().sub(w).normalize()) < 0.25) continue;
    const q = w.clone().project(camera); if (Math.abs(q.x) > 0.98 || Math.abs(q.y) > 0.98 || q.z > 1) continue;
    const px = Math.round((q.x + 1) / 2 * W), py = Math.round((1 - q.y) / 2 * H), i = (py * W + px) * 4;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx < 0.08) continue;
    let h = 0; if (mx > mn) { if (mx === r) h = 60 * (((g - b) / (mx - mn)) % 6); else if (mx === g) h = 60 * ((b - r) / (mx - mn) + 2); else h = 60 * ((r - g) / (mx - mn) + 4); }
    if (h < 0) h += 360; hs.push(h > 180 ? h - 360 : h); ss.push(mx > 0 ? (mx - mn) / mx : 0); vs.push(mx); }
  const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  return { n: hs.length, hue: med(hs), sat: med(ss), val: med(vs) };
}

// =====================================================================================================
// 13. FILM 27 "AME" EXTENSIONS — scene capture (colour + depth), lens rain (falling streaks that freeze into tiny lenses),
//     hero lens drops (JS-driven: drips, hits, tapped bells), crown splashes, sparkles. All share one RAIN CLOCK so the
//     freeze / unfreeze is a single event that travels through the world as a wave (FREEZE uniforms below).
// =====================================================================================================
// scene capture without the drops: colour (lens interiors, bokeh tint, streak light) + depth (world-anchored paint)
export function sceneCapture({ res = [960, 540] } = {}) {
  const depth = new THREE.DepthTexture(res[0], res[1]); depth.type = THREE.UnsignedIntType;
  const rt = new THREE.WebGLRenderTarget(res[0], res[1], { type: THREE.HalfFloatType, depthTexture: depth, depthBuffer: true });
  return { rt, texture: rt.texture, depth,
    render(renderer, scene, camera, hide = []) { const vis = hide.map(o => [o, o.visible]); vis.forEach(([o]) => o.visible = false);
      const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, camera); renderer.setRenderTarget(prev); vis.forEach(([o, v]) => o.visible = v); } };
}

// Freeze uniforms shared by every rain-clock user. t0 = touch time, w0 = touch point, c = wave speed (units/s), tau = stop
// time constant, ba / bw = overshoot (seconds of clock, rad/s), t1 / w1 / c1 = unfreeze wave, goldSp = speed of the gold rain.
export function freezeUniforms() {
  return { uT: { value: 0 }, uT0: { value: 1e6 }, uW0: { value: new V3() }, uWC: { value: 7 }, uTau: { value: 0.045 }, uBA: { value: 0.0025 }, uBW: { value: 38 },
    uT1: { value: 1e6 }, uW1: { value: new V3() }, uWC1: { value: 5 }, uGoldSp: { value: 0.6 }, uGold: { value: 0 } };
}
// GLSL: per-drop rain clock. dF = distance to the freeze origin (position at t0), returns clock and velocity factor.
const GLSL_CLOCK = `
uniform float uT, uT0, uWC, uTau, uBA, uBW, uT1, uWC1, uGoldSp, uGold; uniform vec3 uW0, uW1;
float rainClock(float dF, out float vel, out float flash, out float tFrozen){
  float tf = uT0 + dF / uWC; tFrozen = tf + uTau; flash = 0.0;
  if (uT <= tf) { vel = 1.0; return uT; }
  float s = uT - tf, e = exp(-s / uTau), e2 = exp(-s / 0.14);
  vel = e + uBA * (uBW * cos(uBW * s) - sin(uBW * s) / 0.14) * e2; flash = exp(-s * 4.0);
  return tf + uTau * (1.0 - e) + uBA * sin(uBW * s) * e2; }
float thawClock(float c, float tFrozen, float dU, inout float vel, inout float flash){
  float tu = uT - uT1 - dU / uWC1; if (tu <= 0.0) return c;
  const float R = 0.8; vel = uGoldSp * min(tu / R, 1.0); flash += exp(-tu * 3.0) * 0.7;
  return tFrozen + uGoldSp * (tu < R ? tu * tu / (2.0 * R) : tu - R * 0.5); }
`;
const GLSL_DROP = `
uniform sampler2D tCap; uniform vec2 uRes; uniform float uMag, uLensK, uGlintK, uBokehK, uSparkK, uLensMin, uBokehMin, uGlintCut;
uniform vec3 uPPos[${MAXP}]; uniform vec3 uPCol[${MAXP}]; uniform int uPN;
vec3 capAt(vec2 uv){ return texture2D(tCap, clamp(uv, 0.002, 0.998)).rgb; }
vec3 capBlur(vec2 uv, float px){ vec2 o = vec2(px) / uRes; return (capAt(uv + o * vec2(0.5, 0.5)) + capAt(uv + o * vec2(-0.5, 0.5)) + capAt(uv + o * vec2(0.5, -0.5)) + capAt(uv - o * 0.5)) * 0.25; }
vec3 softClamp(vec3 c, float k){ c = max(c, 0.0); float m = max(c.r, max(c.g, c.b)); return c / (1.0 + k * m); }
vec3 catchL(vec3 Nw, vec3 P, float thr){ vec3 V = normalize(cameraPosition - P), Rv = reflect(-V, Nw), acc = vec3(0.0);
  for (int i = 0; i < ${MAXP}; i++){ if (i >= uPN) break; vec3 L = normalize(uPPos[i] - P); float g = smoothstep(thr, thr + 0.01, dot(Rv, L));
    vec3 pc = uPCol[i] / max(max(uPCol[i].r, max(uPCol[i].g, uPCol[i].b)), 1e-3); acc += (pc * 0.7 + 0.3) * g; } return acc; }
vec3 goldify(vec3 c){ return mix(c, c * vec3(1.22, 0.98, 0.6) + vec3(0.07, 0.04, 0.0), uGold); }
// colour of the neon that lights this point (rig points weighted by brightness / distance), normalised
vec3 neonAt(vec3 P){ vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < ${MAXP}; i++){ if (i >= uPN) break; vec3 pc = uPCol[i]; float m = max(max(pc.r, pc.g), max(pc.b, 1e-3)), d = length(uPPos[i] - P), w = m / (1.0 + d * d * 0.06);
    acc += pc / m * w; ws += w; } return ws > 0.0 ? acc / ws : vec3(1.0); }
// one drop, premultiplied rgba. frag/hs = pixel coords, rpx = radius px, coc = blur radius px (behind focus), P = world centre,
// tint = neon tint, bright 0..1 = per-drop sparkle, flash = freeze / tap wave light, ring = seconds since a tap (<0 none), sy = vertical stretch
vec4 dropShade(vec2 frag, vec2 hs, float rpx, float coc, vec3 P, vec3 tint, float bright, float flash, float ring, float sy){
  vec2 cuv = hs / uRes, d2 = frag - hs; float d = length(d2);
  if (coc > max(rpx * 1.3, 2.0)) {                                   // far: soft bokeh disc tinted by the neon behind (only the sparkling ones)
    if (bright < uBokehMin) return vec4(0.0);
    float cov = clamp(coc + 0.5 - d, 0.0, 1.0); if (cov <= 0.0) return vec4(0.0);
    float edge = 1.0 + 0.3 * smoothstep(coc - 3.0, coc - 0.4, d), bb = (bright - uBokehMin) / (1.0 - uBokehMin);
    vec3 bg = softClamp(capAt(cuv), 0.3), nt = neonAt(P);
    vec3 c = (bg * 0.9 + nt * (0.25 + 0.45 * bb) * (0.4 + dot(bg, vec3(0.3, 0.59, 0.11))) + flash * 0.5) * edge * (0.6 + 0.7 * bb) * uBokehK;
    float a = cov * (0.08 + 0.2 * bb);
    return vec4(applyFog(goldify(c), P) * a, a * 0.5); }
  if (rpx < uLensMin) {                                               // mid: small glint tinted by the neon (+ a 4-point star on the brightest)
    if (bright < uGlintCut) return vec4(0.0);                          // R1: ~half of the mid glints off -> glass, not snow
    float rr = max(rpx * 0.55, 0.65), cov = clamp(rr + 0.5 - length(d2 * vec2(1.0, 0.6)), 0.0, 1.0), star = 0.0;   // slightly tall: a water drop, not snow
    if (bright > 0.9) star = (exp(-abs(d2.y) * 1.5) * exp(-abs(d2.x) / (rr * 3.0 + 1.5)) + exp(-abs(d2.x) * 1.5) * exp(-abs(d2.y) / (rr * 3.0 + 1.5))) * uSparkK * (bright - 0.9) * 8.0;
    vec3 bg = softClamp(capAt(cuv), 0.45), nt = neonAt(P);
    vec3 c = bg * 0.8 + nt * (0.35 + 0.9 * bright) + vec3(1.0) * smoothstep(0.93, 1.0, bright) * 0.8 + flash * 1.2;
    float a = clamp(cov * (0.3 + 0.55 * bright) + star * 0.6, 0.0, 1.0);
    return vec4(applyFog(goldify(c), P) * a * uGlintK, a * 0.8); }
  vec2 q = d2 / rpx; q.y /= sy; float r2 = dot(q, q), r = sqrt(r2);   // near: a real little lens
  if (q.y > 0.0) { q.x /= max(1.0 - 0.38 * q.y * q.y, 0.3); r2 = dot(q, q); r = sqrt(r2); }   // slight teardrop (narrow top)
  float cov = clamp((1.0 - r) * rpx + 0.5, 0.0, 1.0); if (cov <= 0.0) return vec4(0.0);
  vec3 Nv = vec3(q, sqrt(max(1.0 - r2, 0.0)));
  float rw = 0.0; if (ring >= 0.0 && ring < 1.8) { float front = ring * 1.6; rw = exp(-pow((r - front) * 8.0, 2.0)) * exp(-ring * 1.6) + exp(-pow((r - front * 0.55) * 10.0, 2.0)) * exp(-ring * 2.4) * 0.6; }
  vec2 quv = q * (1.0 + 0.5 * r2) * (1.0 + rw * 0.3);
  vec3 ins = capBlur(cuv - quv * rpx * uMag / uRes, 1.5);              // the street behind, FLIPPED + compressed (ball lens)
  ins = softClamp(ins, 0.75) * 1.45; ins = max(mix(vec3(dot(ins, vec3(0.3, 0.59, 0.11))), ins, 1.35), 0.0);
  vec3 col = ins * (0.62 + 0.38 * Nv.z) * uLensK;
  vec3 top = softClamp(capBlur(cuv + vec2(0.0, 3.0 * rpx) / uRes, 4.0), 0.6);
  float cres = smoothstep(0.48, 0.84, r) * smoothstep(0.1, 0.85, -q.y / max(r, 1e-3)) * (1.0 - smoothstep(0.86, 0.96, r));
  col += (top * 1.1 + tint * 0.2 + 0.05) * cres;                      // light gathered at the bottom
  col *= 1.0 - 0.88 * smoothstep(0.84, 0.965, r);                     // thin dark edge
  vec3 Nw = transpose(mat3(viewMatrix)) * Nv;
  col += catchL(Nw, P, 0.966) * 1.5;                                   // neon catchlights
  vec2 hq = (q - vec2(-0.35, 0.38)) * vec2(1.0, 1.3); float hS = 0.15 + 0.03 * bright;
  float hl = 1.0 - smoothstep(hS, hS + 1.3 / rpx, length(hq));
  float hl2 = 1.0 - smoothstep(0.05, 0.05 + 1.3 / rpx, length(q - vec2(0.3, -0.45)));
  col = mix(col, vec3(1.9, 1.86, 1.8), hl) + vec3(0.7) * hl2;
  col += vec3(1.0, 0.96, 0.9) * rw * 1.4 + (cres + 0.15) * flash * 0.8;
  float a = cov * 0.97;
  return vec4(goldify(col) * a, a); }
`;

// Lens rain: falling streaks with motion length = speed; after the freeze wave they stop with a tiny overshoot and become
// drops shaded by distance: near lenses / mid glints / far bokeh. shelter = {pos, r} (no falling drops under it),
// push = {pos, r} (frozen drops part around Clawd), keep = {pos, r} (clear cone camera -> face), taps = 4 waves of light.
export function lensRain({ rig, capture, count = 30000, center = new V3(), box = [20, 14, 30], speed = 22, len = 0.35, width = 0.004, size = [0.005, 0.013],
  wind = new V3(0.05, 0, 0.03), tints = [0xd8d8f0], seed = 5, streakA = 0.5, focus = 4, coc = 10, cocMax = 13, mag = 5, freeze = null } = {}) {
  const R = rng(seed), quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
  const off = new Float32Array(count * 3), rnd = new Float32Array(count * 4), tc = new Float32Array(count * 3), T = tints.map(C);
  for (let i = 0; i < count; i++) { off.set([R(), R(), R()], i * 3); rnd.set([R(), R(), R(), R()], i * 4); const c = T[Math.floor(R() * T.length)]; tc.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3)); g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4)); g.setAttribute('aCol', new THREE.InstancedBufferAttribute(tc, 3));
  g.instanceCount = count;
  const F = freeze || freezeUniforms();
  const U = { ...rig.u, ...F, tCap: { value: capture.texture }, uRes: { value: new THREE.Vector2(1920, 1080) }, uMag: { value: mag }, uLensK: { value: 1 }, uGlintK: { value: 1 }, uBokehK: { value: 1 }, uSparkK: { value: 1 }, uLensMin: { value: 3.4 }, uBokehMin: { value: 0.5 }, uGlintCut: { value: 0.55 },
    uC: { value: center }, uBox: { value: new V3(...box) }, uSpeed: { value: speed }, uLen: { value: len }, uW: { value: width }, uSize: { value: new THREE.Vector2(...size) }, uWind: { value: wind },
    uStreakA: { value: streakA }, uFocus: { value: focus }, uCoC: { value: coc }, uCoCMax: { value: cocMax }, uNearHide: { value: 0.42 }, uFarThin: { value: 14 },
    uSh: { value: new THREE.Vector4(0, -1e5, 0, 0) }, uPush: { value: new THREE.Vector4(0, -1e5, 0, 0) }, uKeep: { value: new THREE.Vector4(0, -1e5, 0, 0) },
    uTap: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -1e6)) }, uDensity: { value: 1 } };
  const mat = cutBlend(new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide,   // the screen-space quad is mirrored for some fall directions
    vertexShader: `${GLSL_CLOCK} attribute vec3 aOff, aCol; attribute vec4 aRnd;
      uniform vec3 uC, uBox, uWind; uniform vec2 uSize, uRes; uniform float uSpeed, uLen, uW, uFocus, uCoC, uCoCMax, uNearHide, uFarThin, uDensity; uniform vec4 uSh, uPush, uKeep, uTap[4];
      varying vec2 vL, vHS; varying float vLen, vR, vCoc, vVel, vFlash, vA, vWpx, vBright; varying vec3 vCol, vP;
      void main(){
        float sp = uSpeed * (0.8 + 0.4 * aRnd.x), H = uBox.y; vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.z));
        vec3 base = uC + vec3((aOff.x - 0.5) * uBox.x, 0.0, (aOff.z - 0.5) * uBox.z);
        float dF = length(base + vec3(0.0, mod(aOff.y * H - uT0 * sp, H), 0.0) - uW0);
        float vel, flash, tFz; float c = rainClock(dF, vel, flash, tFz);
        float dU = length(base + vec3(0.0, mod(aOff.y * H - tFz * sp, H), 0.0) - uW1);
        c = thawClock(c, tFz, dU, vel, flash);
        vec3 p = base + vec3(0.0, mod(aOff.y * H - c * sp, H), 0.0);
        float frozen = 1.0 - clamp(vel, 0.0, 1.0);
        for (int i = 0; i < 4; i++){ float tt = uT - uTap[i].w; if (tt > 0.0 && tt < 3.5){ float dd = length(p - uTap[i].xyz), fr = dd - tt * 2.4; flash += exp(-fr * fr * 5.0) * exp(-tt * 1.1) * 1.3 * frozen; } }
        float A = step(aRnd.w, uDensity);
        vec3 q = p - uPush.xyz; float dq = length(q);
        if (dq < uPush.w) { p += q / max(dq, 1e-4) * (uPush.w - dq) * 0.55 * frozen; A *= mix(1.0, smoothstep(0.35, 0.8, dq / uPush.w), frozen); }
        if (length(p.xz - uSh.xz) < uSh.w && p.y < uSh.y) A *= frozen;      // sheltered: no falling drops under the leaf
        vec3 cam = cameraPosition, ax = uKeep.xyz - cam; float la = length(ax); ax /= max(la, 1e-4); float tA = dot(p - cam, ax);
        if (uKeep.w > 0.0 && tA > 0.0 && tA < la + uKeep.w * 0.5) { float rad = mix(0.1, uKeep.w, clamp(tA / la, 0.0, 1.0)); A *= smoothstep(rad * 0.6, rad, length((p - cam) - ax * tA)); }
        vec4 ch = projectionMatrix * viewMatrix * vec4(p, 1.0);
        float dist = ch.w; if (dist > uFarThin && aRnd.y > uFarThin / dist) A = 0.0;       // thin the far field (density ~ screen)
        float L = uLen * (0.7 + 0.6 * aRnd.y) * clamp(vel, 0.0, 1.6) * (1.0 + 0.6 * uGold * 0.0);
        vec4 ct = projectionMatrix * viewMatrix * vec4(p - dir * L, 1.0);
        float r = mix(uSize.x, uSize.y, aRnd.z * aRnd.z * aRnd.z);
        float rpx = r * projectionMatrix[1][1] * uRes.y * 0.5 / max(dist, 1e-3);
        float coc = dist > uFocus ? min(uCoC * (1.0 - uFocus / dist), uCoCMax) : 0.0;
        float bright = aRnd.x * aRnd.w > 0.0 ? fract(aRnd.x * 7.31 + aRnd.z * 3.7) : 0.0;
        float Rq = max(max(rpx, coc), 0.8) + 1.5; if (bright > 0.9 && rpx < 6.0) Rq = max(Rq, 11.0);
        vec2 hs = (ch.xy / ch.w * 0.5 + 0.5) * uRes, ts = (ct.xy / max(ct.w, 1e-3) * 0.5 + 0.5) * uRes; if (ct.w < 0.05) ts = hs;
        vec2 a2 = ts - hs; float l2 = length(a2); a2 = l2 > 0.01 ? a2 / l2 : vec2(0.0, 1.0); vec2 n2 = vec2(-a2.y, a2.x);
        float along = mix(-Rq, l2 + Rq, position.y + 0.5), across = position.x * 2.0 * Rq;
        vec2 s2 = hs + a2 * along + n2 * across;
        vL = vec2(across, along); vHS = hs; vLen = l2; vR = rpx; vCoc = coc; vVel = vel; vFlash = flash; vCol = aCol; vP = p; vBright = bright;
        vWpx = uW * projectionMatrix[1][1] * uRes.y * 0.5 / max(dist, 1e-3);
        vA = A * smoothstep(uNearHide, uNearHide + 0.25, dist);
        gl_Position = vec4((s2 / uRes * 2.0 - 1.0) * ch.w, ch.z, ch.w);
        if (vA < 0.003 || ch.w < 0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
    fragmentShader: `${GLSL_NOISE} ${GLSL_FOG} uniform float uGold, uStreakA; ${GLSL_DROP}
      varying vec2 vL, vHS; varying float vLen, vR, vCoc, vVel, vFlash, vA, vWpx, vBright; varying vec3 vCol, vP;
      void main(){
        float m = smoothstep(0.3, 0.06, vVel); vec4 o = vec4(0.0);
        if (m < 0.999) {
          float wpx = clamp(vWpx, 0.6, 1.7), dS = vL.y < 0.0 ? length(vL) : (vL.y > vLen ? length(vL - vec2(0.0, vLen)) : abs(vL.x));
          float s = clamp(wpx + 0.5 - dS, 0.0, 1.0) * min(vWpx / 0.6, 1.0) * mix(1.0, 0.55, smoothstep(1.7, 6.0, vWpx)), g = 1.0 - clamp(vL.y / max(vLen, 1.0), 0.0, 1.0);
          vec3 bg = softClamp(capAt(gl_FragCoord.xy / uRes), 0.5);
          vec3 c = vCol * 0.22 + bg * 0.95 + 0.05; c = mix(c, vec3(1.0, 0.7, 0.3) * (0.6 + 0.7 * dot(bg, vec3(0.3, 0.59, 0.11))) + bg * 0.25, uGold);
          float a = s * (0.25 + 0.75 * g) * uStreakA * (1.0 + 0.4 * uGold);
          o += vec4(applyFog(c, vP) * a, a) * (1.0 - m); }
        if (m > 0.001) o += dropShade(gl_FragCoord.xy, vHS, vR, vCoc, vP, vCol, vBright, vFlash, -1.0, 1.0) * m;
        o *= vA; if (o.a < 0.002) discard;
        gl_FragColor = vec4(o.rgb, clamp(o.a, 0.0, 1.0)); }` }), 'premult');
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 8; mesh.raycast = () => {};
  mesh.userData.u = U;
  mesh.userData.set = (o = {}) => { if (o.shelter) U.uSh.value.set(o.shelter.pos.x, o.shelter.pos.y, o.shelter.pos.z, o.shelter.r); if (o.push) U.uPush.value.set(o.push.pos.x, o.push.pos.y, o.push.pos.z, o.push.r);
    if (o.keep) U.uKeep.value.set(o.keep.pos.x, o.keep.pos.y, o.keep.pos.z, o.keep.r); for (const k of ['focus', 'coc', 'cocMax', 'streakA', 'density', 'mag', 'lensMin', 'bokehMin']) if (o[k] != null) U['u' + { focus: 'Focus', coc: 'CoC', cocMax: 'CoCMax', streakA: 'StreakA', density: 'Density', mag: 'Mag', lensMin: 'LensMin', bokehMin: 'BokehMin' }[k]].value = o[k];
    if (o.lensK != null) U.uLensK.value = o.lensK; if (o.glintK != null) U.uGlintK.value = o.glintK; if (o.bokehK != null) U.uBokehK.value = o.bokehK; };
  return mesh;
}

// Hero lens drops (JS-driven, up to n): per instance pos, radius, fall speed (streak), tap ring age, flash, tint, brightness.
// drops.userData.write(i, { p, r, v, ring, flash, tint, bright }) then .commit(count)
export function lensDrops({ rig, capture, n = 64, freeze = null, mag = 5 } = {}) {
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), aD = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), aT = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  [aP, aD, aT].forEach(a => a.setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aP', aP); g.setAttribute('aD', aD); g.setAttribute('aT', aT); g.instanceCount = 0;
  const F = freeze || freezeUniforms();
  const U = { ...rig.u, ...F, tCap: { value: capture.texture }, uRes: { value: new THREE.Vector2(1920, 1080) }, uMag: { value: mag }, uLensK: { value: 1 }, uGlintK: { value: 1 }, uBokehK: { value: 1 }, uSparkK: { value: 1 }, uLensMin: { value: 2.5 }, uBokehMin: { value: 0.0 }, uGlintCut: { value: 0.0 } };
  const mat = cutBlend(new THREE.ShaderMaterial({ uniforms: U,
    vertexShader: `attribute vec4 aP, aD, aT; uniform vec2 uRes; varying vec2 vHS; varying float vR, vRing, vFlash, vBright, vSy; varying vec3 vP, vTint;
      void main(){ vec4 ch = projectionMatrix * viewMatrix * vec4(aP.xyz, 1.0); float rpx = aP.w * projectionMatrix[1][1] * uRes.y * 0.5 / max(ch.w, 1e-3);
        float sy = 1.0 + clamp(aD.x * 0.035 / max(aP.w, 1e-4), 0.0, 6.0);        // motion stretch from the fall speed
        vec2 hs = (ch.xy / ch.w * 0.5 + 0.5) * uRes; float Rq = max(rpx, 0.8) * sy + 2.0;
        vec2 s2 = hs + position.xy * 2.0 * vec2(max(rpx, 0.8) + 2.0, Rq);
        vHS = hs; vR = max(rpx, 0.5); vRing = aD.y; vFlash = aD.z; vBright = aD.w; vSy = sy; vP = aP.xyz; vTint = aT.xyz;
        gl_Position = vec4((s2 / uRes * 2.0 - 1.0) * ch.w, ch.z, ch.w); if (aP.w <= 0.0 || ch.w < 0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
    fragmentShader: `${GLSL_NOISE} ${GLSL_FOG} uniform float uGold; ${GLSL_DROP} varying vec2 vHS; varying float vR, vRing, vFlash, vBright, vSy; varying vec3 vP, vTint;
      void main(){ vec4 o = dropShade(gl_FragCoord.xy, vHS, max(vR, 2.7), 0.0, vP, vTint, vBright, vFlash, vRing, vSy); if (o.a < 0.002) discard; gl_FragColor = o; }` }), 'premult');
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 9; mesh.raycast = () => {};
  mesh.userData.u = U;
  mesh.userData.write = (i, { p, r = 0.03, v = 0, ring = -1, flash = 0, tint = 0xffffff, bright = 0.5 }) => { const t = C(tint);
    aP.setXYZW(i, p.x, p.y, p.z, r); aD.setXYZW(i, v, ring, flash, bright); aT.setXYZW(i, t.r, t.g, t.b, 0); };
  mesh.userData.commit = (count) => { g.instanceCount = Math.min(count, n); aP.needsUpdate = aD.needsUpdate = aT.needsUpdate = true; };
  return mesh;
}

// Crown splashes: billboards (vertical axis) at fixed points (ground: static; leaf / head: write positions per frame),
// cycling with the rain clock -> they freeze mid-air with the rain. Drawn as a crown of droplets + a flat bright splat.
export function splashes({ rig, capture, n = 800, positions = null, size = 0.2, period = [0.32, 0.6], seed = 9, freeze = null, k = 1 } = {}) {
  const R = rng(seed), quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), aR = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  for (let i = 0; i < n; i++) { if (positions) aP.setXYZW(i, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], 1); aR.setXYZW(i, R(), period[0] + (period[1] - period[0]) * R(), R(), R()); }
  aP.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aP', aP); g.setAttribute('aR', aR); g.instanceCount = positions ? n : 0;
  const F = freeze || freezeUniforms();
  const U = { ...rig.u, ...F, tCap: { value: capture.texture }, uRes: { value: new THREE.Vector2(1920, 1080) }, uSize: { value: size }, uK: { value: k } };
  const mat = cutBlend(new THREE.ShaderMaterial({ uniforms: U,
    vertexShader: `${GLSL_CLOCK} attribute vec4 aP, aR; uniform float uSize; varying vec2 vUv; varying float vPh, vOn, vS; varying vec3 vW;
      void main(){ float vel, fl, tFz; float c = rainClock(length(aP.xyz - uW0), vel, fl, tFz); c = thawClock(c, tFz, length(aP.xyz - uW1), vel, fl);
        float ph = fract(c / aR.y + aR.x); vPh = ph; vOn = aP.w; vS = aR.z;
        vec3 V = cameraPosition - aP.xyz; vec3 rt = normalize(vec3(V.z, 0.0, -V.x)); float s = uSize * (0.7 + 0.6 * aR.w);
        vec3 w = aP.xyz + rt * position.x * s * 1.4 + vec3(0.0, position.y * s, 0.0); vUv = vec2(position.x * 1.4, position.y); vW = aP.xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); if (aP.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
    fragmentShader: `${GLSL_NOISE} ${GLSL_FOG} uniform sampler2D tCap; uniform vec2 uRes; uniform float uGold, uK; varying vec2 vUv; varying float vPh, vOn, vS; varying vec3 vW;
      vec3 goldify(vec3 c){ return mix(c, c * vec3(1.22, 0.98, 0.6) + vec3(0.07, 0.04, 0.0), uGold); }
      void main(){ float t = vPh / 0.42; if (t > 1.0) discard;
        float a = 0.0, wv = 0.12 + 0.42 * t, h = 0.55 * sin(3.14159 * min(t * 1.25, 1.0));
        for (int k = 0; k < 7; k++){ float th = (float(k) + 0.5) / 7.0 * 3.14159 + (vS - 0.5) * 0.4; float x = cos(th) * wv * (1.0 + 0.25 * t);
          float y = (0.25 + 0.75 * sin(th)) * (h + 0.4 * t * t * 0.0) + 0.04; float rr = 0.045 * (1.0 - 0.5 * t) + 0.012;
          a = max(a, smoothstep(rr, rr * 0.45, length((vUv - vec2(x, y)) * vec2(1.0, 0.8)))); }
        float wall = smoothstep(0.035, 0.0, abs(abs(vUv.x) - wv * 0.85)) * smoothstep(h * 0.75 + 0.02, 0.0, vUv.y) * (1.0 - t);
        float splat = smoothstep(0.06, 0.0, abs(vUv.y - 0.012)) * smoothstep(wv * 1.1, wv * 0.6, abs(vUv.x)) * (1.0 - t * 0.7);
        a = max(a, max(wall * 0.8, splat * 0.7)) * (1.0 - smoothstep(0.6, 1.0, t)) * uK;
        vec3 bg = min(texture2D(tCap, clamp(gl_FragCoord.xy / uRes, 0.002, 0.998)).rgb, vec3(1.2));
        vec3 c = goldify(bg * 1.3 + 0.28);
        gl_FragColor = vec4(applyFog(c, vW) * a, a); }` }), 'premult');
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 8; mesh.raycast = () => {};
  mesh.userData.u = U;
  mesh.userData.write = (i, p, on = 1) => aP.setXYZW(i, p.x, p.y, p.z, on);
  mesh.userData.commit = (count) => { g.instanceCount = Math.min(count, n); aP.needsUpdate = true; };
  return mesh;
}

// Sparkles: 4-point star glints + soft core (tap glints, freeze sparkle). write(i, {p, px, color, k}) + commit(count)
export function sparkles({ n = 128 } = {}) {
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), aC = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  [aP, aC].forEach(a => a.setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aP', aP); g.setAttribute('aC', aC); g.instanceCount = 0;
  const U = { uRes: { value: new THREE.Vector2(1920, 1080) } };
  const mat = cutBlend(new THREE.ShaderMaterial({ uniforms: U,
    vertexShader: `attribute vec4 aP, aC; uniform vec2 uRes; varying vec2 vQ; varying vec4 vC; varying float vS;
      void main(){ vec4 ch = projectionMatrix * viewMatrix * vec4(aP.xyz, 1.0); float s = aP.w; vec2 hs = (ch.xy / ch.w * 0.5 + 0.5) * uRes;
        vQ = position.xy * 2.0 * s; vC = aC; vS = s; vec2 s2 = hs + vQ; gl_Position = vec4((s2 / uRes * 2.0 - 1.0) * ch.w, ch.z, ch.w); if (s <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
    fragmentShader: `varying vec2 vQ; varying vec4 vC; varying float vS;
      void main(){ vec2 q = abs(vQ); float w = max(vS * 0.06, 0.7);
        float st = exp(-q.y / w) * (1.0 - smoothstep(0.0, vS, q.x)) + exp(-q.x / w) * (1.0 - smoothstep(0.0, vS, q.y));
        float d = length(vQ), core = exp(-d * d / (w * w * 4.0));
        float a = clamp((st * 0.8 + core) * vC.a, 0.0, 1.0); if (a < 0.003) discard; gl_FragColor = vec4(vC.rgb * a * 1.6, a * 0.5); }` }), 'premult');
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.raycast = () => {};
  mesh.userData.write = (i, { p, px = 16, color = 0xffffff, k = 1 }) => { const c = C(color); aP.setXYZW(i, p.x, p.y, p.z, px); aC.setXYZW(i, c.r, c.g, c.b, k); };
  mesh.userData.commit = (count) => { g.instanceCount = Math.min(count, n); aP.needsUpdate = aC.needsUpdate = true; };
  return mesh;
}
