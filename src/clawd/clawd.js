// Soft Clawd for three.js (0.160, 'three' + 'three/addons/' from the importmap).
//   import { loadClawd } from './clawd/clawd.js';
//   const clawd = await loadClawd();                 // default: clawd.glb next to this file
//   scene.add(clawd.root);
//   clawd.setEmotion('panic');                       // instant switch
//   clawd.setEmotion('smug', { mix: 'happy', t: 0.3 }); // blend two emotions (morphs/transforms of shared parts)
//   clawd.pose({ armL: 40, armR: 40, squash: 0.1, blink: 0.0, lookX: 0.3 });
// Conventions: units = body width 1.0 (scale clawd.root as needed), feet at y = 0, body centred on x/z, the face
// looks toward +Z, +Y up. "L"/"R" in node names = the viewer's left/right (x < 0 is L).
// setEmotion() stores the face state; pose() is absolute — a pure function of its arguments on top of the current
// emotion (no time, no accumulation, no randomness). Per frame: setEmotion(...) then pose(...).
// Emotions = emotions/<name>.json next to this file (shared with the Blender builder of the mascot, not part of this repo).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEG = Math.PI / 180;
const EYE_RZ = 0.092;
const BLINKABLE = ['eye_', 'eyeWhite_', 'eyeStar_', 'eyeHeart_', 'eyeSpiral_'];
const LOOK = [['eye', 0.035], ['brow', 0.028], ['mouth', 0.018], ['tongue', 0.018], ['', 0.012]];
const SUB_OFF = ['_hl2', '_tongue'];          // sub-parts hidden unless an emotion's "sub" turns them on
const hlV = (lid) => Math.min(0.45 * EYE_RZ, EYE_RZ * (1 - 0.9 * lid) - 0.22 * EYE_RZ);
const lerp = (a, b, t) => a + (b - a) * t;

// Soft terracotta vinyl (matches mascot/model-sheet.jpg); colours are sRGB hex.
export function makeMaterials() {
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
  return {
    clawd_body: P({ color: 0xD97757, roughness: 0.52, metalness: 0, specularIntensity: 0.45, clearcoat: 0.18, clearcoatRoughness: 0.42,
      sheen: 0.5, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xFFB59A), envMapIntensity: 0.5 }),
    clawd_ink: P({ color: 0x1E1612, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.08, ...decal }),
    clawd_shine: P({ color: 0xFFFFFF, roughness: 0.3, emissive: 0xFFFFFF, emissiveIntensity: 0.35, ...decal }),
    clawd_blush: P({ color: 0xEE8C7C, roughness: 0.7, ...decal }),
    clawd_heart: P({ color: 0xE2466A, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.15, ...decal }),
    clawd_water: P({ color: 0x9ED9F2, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, ...decal }),
    clawd_white: P({ color: 0xFBF7F2, roughness: 0.28, clearcoat: 0.4, ...decal }),
    clawd_mouth: P({ color: 0x4A1A16, roughness: 0.35, clearcoat: 0.3, ...decal }),
    clawd_tongue: P({ color: 0xEC6F78, roughness: 0.4, clearcoat: 0.2, ...decal }),
    clawd_tongue_line: P({ color: 0xB8424E, roughness: 0.5, ...decal }),
  };
}

export async function loadClawd(url = new URL('./clawd.glb', import.meta.url).href,
  { emotionsUrl = new URL('./emotions/', import.meta.url).href, materials = makeMaterials(), shadows = true } = {}) {
  const [gltf, index] = await Promise.all([
    new GLTFLoader().loadAsync(url),
    fetch(new URL('index.json', emotionsUrl)).then(r => r.json()),
  ]);
  const emotions = {};
  await Promise.all(index.emotions.map(async n => { emotions[n] = await fetch(new URL(n + '.json', emotionsUrl)).then(r => r.json()); }));

  const root = gltf.scene;
  root.name = 'ClawdRoot';
  const nodes = {};
  root.traverse(o => {
    nodes[o.name.replace(/^Clawd_/, '')] = o;
    if (o.isMesh) {
      const m = materials[o.material?.name];
      if (m) o.material = m;
      o.castShadow = shadows; o.receiveShadow = shadows && o.material === materials.clawd_body;
    }
  });
  const rig = nodes.squash, face = nodes.face, armL = nodes.arm_L, armR = nodes.arm_R;
  const parts = face.children.map(o => {
    const short = o.name.replace(/^Clawd_/, '');
    const subs = [];
    o.traverse(c => { if (c !== o) subs.push({ obj: c, name: c.name.replace(/^Clawd_/, ''), restY: c.position.y }); });
    return { obj: o, name: short, rest: o.position.clone(), look: LOOK.find(([p]) => short.startsWith(p))[1],
      blink: BLINKABLE.some(p => short.startsWith(p)), isEye: short.startsWith('eye_'), subs };
  });

  let state = null;   // { parts: {name: {x,y,rot,sx,sy,morph}}, subs: {name: bool}, twitchEye }
  const partSpec = (emo, p) => {
    const s = emo.parts?.[p.name]; if (!s) return null;
    const sc = s.s ?? 1, [sx, sy] = Array.isArray(sc) ? sc : [sc, sc];
    return { x: s.x ?? p.rest.x, y: s.y ?? p.rest.y, rot: s.rot ?? 0, sx, sy, morph: { ...(s.morph || {}) } };
  };
  const subOn = (emo, name) => emo.sub?.[name] ?? !SUB_OFF.some(e => name.endsWith(e));

  function setEmotion(name, opts = {}) {
    const A = emotions[name]; if (!A) throw new Error('clawd: unknown emotion ' + name);
    const B = opts.mix ? emotions[opts.mix] : null; if (opts.mix && !B) throw new Error('clawd: unknown emotion ' + opts.mix);
    const t = B ? Math.min(1, Math.max(0, opts.t ?? 0.5)) : 0;
    const st = { parts: {}, subs: {}, twitchEye: (t < 0.5 || !B ? A : B).twitchEye || 'eye_L' };
    for (const p of parts) {
      const a = partSpec(A, p), b = B ? partSpec(B, p) : null;
      let r = null;
      if (a && b) {
        const morph = {};
        for (const k of new Set([...Object.keys(a.morph), ...Object.keys(b.morph)])) morph[k] = lerp(a.morph[k] || 0, b.morph[k] || 0, t);
        r = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), rot: lerp(a.rot, b.rot, t), sx: lerp(a.sx, b.sx, t), sy: lerp(a.sy, b.sy, t), morph };
      } else if (a && t < 0.5) r = a; else if (b && t >= 0.5) r = b;
      if (r) st.parts[p.name] = r;
      for (const s of p.subs) st.subs[s.name] = subOn(t < 0.5 || !B ? A : B, s.name);
    }
    state = st;
    applyFace({});
  }

  function applyFace({ blink = 0, lookX = 0, lookY = 0, twitch = 0 }) {
    for (const p of parts) {
      const s = state.parts[p.name], o = p.obj;
      o.visible = !!s; if (!s) continue;
      const morph = { ...s.morph };
      let sy = s.sy;
      if (p.blink) sy *= Math.max(0.08, 1 - blink);
      if (p.name === state.twitchEye && twitch > 0) { morph.lid = Math.max(morph.lid || 0, Math.min(1, 1.4 * twitch)); sy *= 1 - 0.45 * twitch; }
      o.position.set(s.x + lookX * p.look, s.y + lookY * p.look * 0.8, p.rest.z);
      o.rotation.set(0, 0, s.rot * DEG);
      o.scale.set(s.sx, sy, 1);
      if (o.morphTargetDictionary) for (const [k, i] of Object.entries(o.morphTargetDictionary)) o.morphTargetInfluences[i] = morph[k] || 0;
      for (const sub of p.subs) {
        let on = state.subs[sub.name];
        if (p.isEye && sub.name.endsWith('_hl')) { sub.obj.position.y = hlV(morph.lid || 0); on = on && blink < 0.5; }
        sub.obj.visible = on;
      }
    }
  }

  // pose: arms in degrees up, squash -0.3..0.3 (+ = squashed: height x (1 - squash), width/depth volume-kept),
  // squashXZ = optional explicit width/depth scale (overrides the volume-kept value; e.g. squash 0.2 + squashXZ 1.25
  // = exactly 1.25 wide x 0.8 tall), lean degrees (+ = forward, top toward the face / +Z), turn degrees (yaw),
  // tilt degrees (roll, + = counter-clockwise as seen from the front), blink 0..1, lookX/lookY -1..1, twitch 0..1.
  // v2 (2026-10-24): lean sign fixed (v1 tilted backward for lean > 0), squashXZ added. v1 is kept in the mascot kit.
  function pose({ armL: aL = 0, armR: aR = 0, squash = 0, squashXZ = null, lean = 0, turn = 0, tilt = 0, blink = 0, lookX = 0, lookY = 0, twitch = 0 } = {}) {
    const sz = 1 - squash, sxz = squashXZ ?? 1 / Math.sqrt(Math.max(sz, 0.05));
    rig.scale.set(sxz, sz, sxz);
    rig.rotation.set(lean * DEG, turn * DEG, tilt * DEG, 'YZX');
    armL.rotation.set(0, 0, -aL * DEG);
    armR.rotation.set(0, 0, aR * DEG);
    applyFace({ blink, lookX, lookY, twitch });
  }

  const emotionPose = (name) => ({ ...(emotions[name]?.pose || {}) });
  setEmotion('neutral'); pose();
  return { root, nodes, materials, emotions: index.emotions, setEmotion, pose, emotionPose };
}
