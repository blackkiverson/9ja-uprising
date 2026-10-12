import * as THREE from 'three';
import type { Body, Garment, Outfit } from './character';

/*
 * The high-detail figure, for the player (seen close up in the clothes stall and wardrobe).
 *
 * The body is a set of smooth tubes swept down the bones: torso, neck, arms and legs, each a stack
 * of rings whose size follows a profile, with skin weights that blend between bones across each
 * joint so elbows and knees bend instead of hinging. Clothes are the same tubes, grown outwards and
 * cut to length: a tee is the torso tube from waist to neckline plus the top of each arm tube. Because a
 * garment shares its body part's profile and weights, it moves exactly with it and never pokes
 * through. Layers are just offsets: tucked shirt, then trousers, then anything worn over.
 *
 * Positions are in the figure's rest space (+y up, +z forward, feet at y = 0).
 */

/** A figure part, already in rest space and skinned. */
export interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  outline: boolean;
}

export interface Limb {
  upper: THREE.Bone;
  lower: THREE.Bone;
  end: THREE.Bone;
  side: number;
}

export interface Rig {
  hips: THREE.Bone;
  chest: THREE.Bone;
  head: THREE.Bone;
  arms: Limb[];
  legs: Limb[];
  index: Map<THREE.Bone, number>;
  rest: Map<THREE.Bone, THREE.Matrix4>;
}

const INK = 0x283130;

/** Skin weights for one ring: bone a, bone b, and how much of b (0..1). */
interface Weight {
  a: number;
  b: number;
  t: number;
}

interface Ring {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

/** Rigidly binds a geometry, built in a bone's own space, to that bone. */
export function rigid(geo: THREE.BufferGeometry, bone: THREE.Bone, rig: Pick<Rig, 'index' | 'rest'>): THREE.BufferGeometry {
  geo.applyMatrix4(rig.rest.get(bone)!);
  const n = geo.getAttribute('position').count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const b = rig.index.get(bone)!;
  for (let i = 0; i < n; i++) {
    si[i * 4] = b;
    sw[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}

/** Weights along a chain: stops are [y, bone] from the top down; bones blend smoothly between stops. */
function chain(rig: Rig, stops: [number, THREE.Bone][]): (y: number) => Weight {
  const s = stops.map(([y, b]) => [y, rig.index.get(b)!] as const);
  const first = s[0]!;
  return (y) => {
    if (y >= first[0]) return { a: first[1], b: first[1], t: 0 };
    for (let i = 0; i < s.length - 1; i++) {
      const [y0, a] = s[i]!;
      const [y1, b] = s[i + 1]!;
      if (y >= y1) {
        const u = (y0 - y) / (y0 - y1);
        return { a, b, t: u * u * (3 - 2 * u) };
      }
    }
    const last = s[s.length - 1]![1];
    return { a: last, b: last, t: 0 };
  };
}

/**
 * A smooth profile through keys [y, rx, rz, z], top to bottom (Catmull-Rom between keys).
 * x is fixed: the limb's line.
 */
function profile(x: number, keys: number[][]): (y: number) => Ring {
  return (y) => {
    const k = keys;
    let i = 0;
    while (i < k.length - 2 && y < k[i + 1]![0]!) i++;
    const p1 = k[i]!;
    const p2 = k[i + 1]!;
    const p0 = k[Math.max(0, i - 1)]!;
    const p3 = k[Math.min(k.length - 1, i + 2)]!;
    const u = THREE.MathUtils.clamp((p1[0]! - y) / (p1[0]! - p2[0]!), 0, 1);
    const cr = (j: number) => {
      const a = p0[j] ?? 0;
      const b = p1[j] ?? 0;
      const c = p2[j] ?? 0;
      const d = p3[j] ?? 0;
      return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    };
    return { x, z: cr(3), rx: cr(1), rz: cr(2) };
  };
}

/** The same profile, grown outwards (a garment's layer) and optionally flared by y. */
function grown(ring: (y: number) => Ring, by: number, flare: (y: number) => number = () => 0): (y: number) => Ring {
  return (y) => {
    const r = ring(y);
    const f = flare(y);
    return { ...r, rx: r.rx + by + f, rz: r.rz + by + f * 0.85 };
  };
}

interface TubeOpts {
  top: number;
  bottom: number;
  ring: (y: number) => Ring;
  weight: (y: number) => Weight;
  /** Ring spacing in metres. */
  step?: number;
  segs?: number;
  /** Cross-section squareness: 2 is an ellipse, higher is boxier. */
  power?: number;
  /** Close an end with a dome; otherwise an open end gets a thick edge (a hem) folding in to `inner`. */
  capTop?: boolean;
  capBottom?: boolean;
  inner?: (y: number) => Ring;
  /** Shaped top edge (necklines, armholes): the highest y the tube reaches at each angle (0 = +x, π/2 = front). */
  cut?: (angle: number) => number;
  /** Per-vertex colour (prints and stripes); null keeps the part's colour. */
  paint?: (y: number, angle: number) => number | null;
}

/** Sweeps rings down a profile into a skinned, smooth-normalled tube in rest space. */
function tube(o: TubeOpts): THREE.BufferGeometry {
  const segs = o.segs ?? 20;
  const step = o.step ?? 0.035;
  const power = o.power ?? 2;
  /** src and dy: where the ring came from, so a cut edge can re-sample it lower down. */
  type R = Ring & { y: number; w: Weight; src?: (y: number) => Ring; dy?: number };
  const rings: R[] = [];
  const at = (y: number, ring = o.ring): R => ({ ...ring(y), y, w: o.weight(y), src: ring, dy: 0 });
  const n = Math.max(1, Math.ceil((o.top - o.bottom) / step));
  for (let i = 0; i <= n; i++) rings.push(at(o.top - ((o.top - o.bottom) * i) / n));

  // Ends: a dome (closed) or a folded-in hem (open).
  const dome = (end: R, dir: number): { rings: R[]; pole: THREE.Vector3 } => {
    const h = Math.min(end.rx, end.rz) * 0.8;
    const out: R[] = [];
    for (let k = 1; k <= 3; k++) {
      const a = (k / 4) * (Math.PI / 2);
      const y = end.y + dir * h * Math.sin(a);
      out.push({ ...end, y, rx: end.rx * Math.cos(a), rz: end.rz * Math.cos(a), w: o.weight(y) });
    }
    return { rings: out, pole: new THREE.Vector3(end.x, end.y + dir * h, end.z) };
  };
  const hem = (end: R, dir: number): R => {
    const src = o.inner ?? ((y: number) => ({ ...o.ring(y), rx: o.ring(y).rx * 0.9, rz: o.ring(y).rz * 0.9 }));
    return { ...src(end.y), y: end.y - dir * 0.006, w: end.w, src, dy: -dir * 0.006 };
  };
  let topPole: THREE.Vector3 | null = null;
  let bottomPole: THREE.Vector3 | null = null;
  if (o.capTop) {
    const d = dome(rings[0]!, 1);
    rings.unshift(...d.rings.reverse());
    topPole = d.pole;
  } else rings.unshift(hem(rings[0]!, 1));
  if (o.capBottom) {
    const d = dome(rings[rings.length - 1]!, -1);
    rings.push(...d.rings);
    bottomPole = d.pole;
  } else rings.push(hem(rings[rings.length - 1]!, -1));

  const pos: number[] = [];
  const skinI: number[] = [];
  const skinW: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const e = 2 / power;
  const vert = (x: number, y: number, z: number, w: Weight, angle: number) => {
    pos.push(x, y, z);
    skinI.push(w.a, w.b, 0, 0);
    skinW.push(w.a === w.b ? 1 : 1 - w.t, w.a === w.b ? 0 : w.t, 0, 0);
    const p = o.paint?.(y, angle);
    if (p === null || p === undefined) col.push(-1, -1, -1);
    else col.push(...c.setHex(p).toArray());
  };
  for (const ring of rings) {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let r = ring;
      // Above the cut, the ring folds down onto the edge.
      const lim = o.cut && ring.src ? o.cut(a) + (ring.dy ?? 0) : Infinity;
      if (ring.y > lim) r = { ...ring.src!(lim), y: lim, w: o.weight(lim) };
      vert(r.x + r.rx * Math.sign(ca) * Math.abs(ca) ** e, r.y, r.z + r.rz * Math.sign(sa) * Math.abs(sa) ** e, r.w, a);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = i * segs + ((j + 1) % segs);
      const cc = a + segs;
      const d = b + segs;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  if (topPole) {
    const p = pos.length / 3;
    vert(topPole.x, topPole.y, topPole.z, o.weight(topPole.y), 0);
    for (let j = 0; j < segs; j++) idx.push(p, (j + 1) % segs, j);
  }
  if (bottomPole) {
    const p = pos.length / 3;
    const base = (rings.length - 1) * segs;
    vert(bottomPole.x, bottomPole.y, bottomPole.z, o.weight(bottomPole.y), 0);
    for (let j = 0; j < segs; j++) idx.push(p, base + j, base + ((j + 1) % segs));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  if (o.paint) g.setAttribute('paint', new THREE.Float32BufferAttribute(col, 3));
  // A hem's folded-in edge gets no outline: it sits against the layer beneath and would flicker.
  const bare = new Float32Array(pos.length / 3).fill(1);
  if (!o.capTop) bare.fill(0, 0, segs);
  if (!o.capBottom) bare.fill(0, (rings.length - 1) * segs, rings.length * segs);
  g.setAttribute('bare', new THREE.BufferAttribute(bare, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Toon shading turns tiny slope wiggles between rings into blotches where a surface sits near a
  // band edge (a back half-turned from the sun). Blur normals up and down the tube so band edges
  // run clean.
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const a = nrm.array as Float32Array;
  for (let pass = 0; pass < 6; pass++) {
    const prev = a.slice();
    for (let i = 2; i < rings.length - 2; i++) {
      for (let j = 0; j < segs; j++) {
        const v = (i * segs + j) * 3;
        for (let k = 0; k < 3; k++) a[v + k] = (prev[v - segs * 3 + k]! + 2 * prev[v + k]! + prev[v + segs * 3 + k]!) / 4;
      }
    }
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < nrm.count; i++) {
    v.fromBufferAttribute(nrm, i).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** Scale, rotate, then move a geometry (a mesh's own order). */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function at(geo: THREE.BufferGeometry, p: [number, number, number], s: [number, number, number] = [1, 1, 1], r: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  return geo.applyMatrix4(_m.compose(_p.set(...p), _q.setFromEuler(_e.set(...r)), _s.set(...s)));
}

/** A colour moved towards another. */
function mix(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

/** Footprint outline, heel to toe, as a flat slab: soles and footbeds. */
function sole(thick: number, grow = 0): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const z0 = -0.085 - grow;
  const z1 = 0.17 + grow;
  // Half-width along the foot: round heel, broad ball, rounded toe.
  const hw = (z: number) => {
    const u = (z - z0) / (z1 - z0);
    const body = 0.047 + 0.02 * Math.sin(u * Math.PI * 0.9);
    const ends = Math.sqrt(Math.max(0, 1 - ((2 * u - 1) ** 8)));
    return (body + grow) * ends;
  };
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const z = z0 + ((z1 - z0) * i) / N;
    pts.push(new THREE.Vector2(hw(z) + 0.004, z));
  }
  for (let i = N; i >= 0; i--) {
    const z = z0 + ((z1 - z0) * i) / N;
    pts.push(new THREE.Vector2(-hw(z) - 0.004, z));
  }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: thick, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 4 });
  // Shape y -> forward (+z); extrude downwards from y = 0.
  g.rotateX(Math.PI / 2);
  g.deleteAttribute('uv');
  return g;
}

/** Everything the body and outfit put on the HD figure. */
export function hdParts(rig: Rig, body: Body, outfit: Outfit): { parts: Part[]; skirt: boolean } {
  const parts: Part[] = [];
  const { top, bottom, shoes, hat } = outfit;
  const w = body.build ?? 1;
  const skin = body.skin;
  const add = (geo: THREE.BufferGeometry, color: number, outline = true) => parts.push({ geo, color, outline });
  const on = (geo: THREE.BufferGeometry, bone: THREE.Bone, color: number, outline = true) => add(rigid(geo, bone, rig), color, outline);
  /**
   * A tube on one or more body chains, `by` metres out from the skin. Whatever a later, outer layer
   * covers loses its outline, or the outline would poke through the cloth on top.
   */
  const layers: { on: string[]; by: number; top: number; bottom: number; geo: THREE.BufferGeometry }[] = [];
  const layer = (on: string[], by: number, o: TubeOpts, color: number, outline = true) => {
    const geo = tube(o);
    add(geo, color, outline);
    layers.push({ on, by, top: o.top, bottom: o.bottom, geo });
  };
  const trim = (g: Garment<string>, fallback: number) => g.accent ?? fallback;
  const shade = (c: number, t = 0.18) => mix(c, 0x000000, t);
  const { hips, chest, head } = rig;

  // ------------------------------------------------------------ body

  const torso = profile(0, [
    [1.82, 0.08, 0.08, 0],
    [1.76, 0.15, 0.115, -0.01],
    [1.69, 0.25 * w, 0.14, -0.012],
    [1.6, 0.3 * w, 0.165, -0.005],
    [1.48, 0.285 * w, 0.185, 0.012],
    [1.36, 0.265 * w, 0.18, 0.016],
    [1.22, 0.235, 0.165, 0.01],
    [1.08, 0.225, 0.155, 0.004],
    [0.96, 0.265, 0.17, -0.004],
    [0.84, 0.275, 0.17, -0.012],
    [0.75, 0.225, 0.145, -0.01],
    [0.71, 0.17, 0.12, -0.01],
  ]);
  const torsoW = chain(rig, [
    [1.15, chest],
    [0.95, hips],
  ]);
  const neck = profile(0, [
    [2.0, 0.08, 0.085, 0],
    [1.88, 0.082, 0.088, -0.006],
    [1.74, 0.1, 0.1, -0.01],
  ]);
  const neckW = chain(rig, [
    [1.98, head],
    [1.8, chest],
  ]);
  const armX = (side: number) => side * 0.36 * w;
  const arm = (side: number) =>
    profile(armX(side), [
      [1.63, 0.1, 0.105],
      [1.56, 0.105, 0.11],
      [1.48, 0.096, 0.098],
      [1.4, 0.085, 0.085],
      [1.28, 0.072, 0.075],
      [1.22, 0.07, 0.072],
      [1.12, 0.075, 0.072],
      [1.0, 0.06, 0.056],
      [0.93, 0.047, 0.042],
      [0.9, 0.046, 0.041],
    ]);
  const armW = (l: Limb) =>
    chain(rig, [
      [1.64, chest],
      [1.5, l.upper],
      [1.3, l.upper],
      [1.18, l.lower],
      [0.95, l.lower],
      [0.88, l.end],
    ]);
  const leg = (side: number) =>
    profile(side * 0.14, [
      [0.98, 0.11, 0.11, 0],
      [0.9, 0.125, 0.128, 0.004],
      [0.84, 0.128, 0.133, 0.005],
      [0.7, 0.115, 0.12, 0.01],
      [0.55, 0.092, 0.098, 0.005],
      [0.47, 0.083, 0.088, 0.005],
      [0.38, 0.087, 0.094, -0.008],
      [0.26, 0.072, 0.078, -0.006],
      [0.14, 0.054, 0.058, 0],
      [0.08, 0.048, 0.052, 0],
      [0.04, 0.046, 0.05, 0],
    ]);
  const legW = (l: Limb) =>
    chain(rig, [
      [0.98, hips],
      [0.84, l.upper],
      [0.53, l.upper],
      [0.41, l.lower],
      [0.12, l.lower],
      [0.06, l.end],
    ]);

  layer(['torso'], 0, { top: 1.82, bottom: 0.71, ring: torso, weight: torsoW, segs: 24, capTop: true, capBottom: true }, skin);
  layer(['neck'], 0, { top: 2.0, bottom: 1.74, ring: neck, weight: neckW, segs: 16, capTop: true, capBottom: true }, skin);
  for (const l of rig.arms) layer([`arm${l.side}`], 0, { top: 1.63, bottom: 0.9, ring: arm(l.side), weight: armW(l), segs: 14, capTop: true, capBottom: true }, skin);
  for (const l of rig.legs) layer([`leg${l.side}`], 0, { top: 0.98, bottom: 0.04, ring: leg(l.side), weight: legW(l), segs: 14, capTop: true, capBottom: true }, skin);

  // Hands: palm, fingers held together, thumb forward. Palms face in.
  for (const l of rig.arms) {
    const inward = -l.side;
    on(at(new THREE.SphereGeometry(0.06, 12, 10), [0, -0.06, 0.005], [0.62, 1.05, 0.95]), l.end, skin);
    on(at(new THREE.CapsuleGeometry(0.03, 0.05, 4, 8), [inward * 0.006, -0.13, 0.008], [0.85, 1, 1.75], [0.12, 0, 0]), l.end, skin);
    on(at(new THREE.CapsuleGeometry(0.019, 0.04, 4, 8), [inward * 0.022, -0.075, 0.05], [1, 1, 1], [0.6, 0, inward * 0.2]), l.end, skin, false);
  }

  // Head: a rounded skull with a narrower jaw, then the face.
  const skull = new THREE.SphereGeometry(0.27, 28, 20);
  const p = skull.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i) * 1.1;
    let z = p.getZ(i);
    if (y < 0) {
      const u = -y / (0.27 * 1.1);
      x *= 1 - 0.2 * u ** 1.6;
      z = z > 0 ? z * (1 - 0.06 * u) : z * (1 - 0.25 * u);
    }
    // Flatter at the back, fuller at the crown.
    if (z < 0) z *= 0.94;
    p.setXYZ(i, x, y, z);
  }
  skull.computeVertexNormals();
  on(skull, head, skin);
  const lip = mix(skin, 0x5a2626, 0.35);
  const white = 0xf0ebe2;
  for (const sx of [-1, 1]) {
    // Ears
    on(at(new THREE.SphereGeometry(0.055, 10, 8), [sx * 0.262, 0.0, -0.01], [0.42, 1, 0.75]), head, skin, false);
    // Eyes: white, iris, and a brow above.
    on(at(new THREE.SphereGeometry(0.043, 12, 8), [sx * 0.098, 0.035, 0.236], [1.15, 0.78, 0.5]), head, white, false);
    on(at(new THREE.SphereGeometry(0.026, 10, 8), [sx * 0.098, 0.034, 0.252], [1, 1, 0.5]), head, 0x24160e, false);
    on(at(new THREE.CapsuleGeometry(0.012, 0.06, 3, 6), [sx * 0.1, 0.098, 0.236], [1, 1, 0.7], [0, 0, sx * (Math.PI / 2 - 0.12)]), head, body.hairColor, false);
  }
  // Broad nose, lips.
  on(at(new THREE.SphereGeometry(0.042, 12, 8), [0, -0.035, 0.262], [1.3, 0.85, 0.8]), head, skin, false);
  on(at(new THREE.SphereGeometry(0.022, 8, 6), [0, 0.0, 0.258], [0.9, 2, 0.9]), head, skin, false);
  on(at(new THREE.CapsuleGeometry(0.017, 0.06, 3, 8), [0, -0.112, 0.232], [1, 1, 0.7], [0, 0, Math.PI / 2]), head, lip, false);
  on(at(new THREE.CapsuleGeometry(0.019, 0.05, 3, 8), [0, -0.138, 0.226], [1, 1, 0.7], [0, 0, Math.PI / 2]), head, lip, false);

  // ------------------------------------------------------------ hair

  const hc = body.hairColor;
  /** Close-cropped hair: a cap over the crown, hairline set back at the front. */
  const crop = (lift = 0) => on(at(new THREE.SphereGeometry(0.282, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), [0, 0.012 + lift, -0.012], [1, 1.1, 0.98], [-0.32, 0, 0]), head, hc, false);
  if (hat && body.hair !== 'bald') crop();
  else
    switch (body.hair) {
      case 'afro': {
        // Coily texture: a ball with a little bumpiness, set back on the skull.
        const g = new THREE.SphereGeometry(0.34, 32, 24);
        const q = g.getAttribute('position') as THREE.BufferAttribute;
        const v = new THREE.Vector3();
        for (let i = 0; i < q.count; i++) {
          v.fromBufferAttribute(q, i);
          const n = Math.sin(v.x * 70) * Math.sin(v.y * 64) * Math.sin(v.z * 58);
          v.multiplyScalar(1 + n * 0.035);
          q.setXYZ(i, v.x, v.y, v.z);
        }
        g.computeVertexNormals();
        on(at(g, [0, 0.12, -0.075], [1.02, 0.92, 0.98]), head, hc);
        break;
      }
      case 'puff':
        crop();
        on(at(new THREE.SphereGeometry(0.15, 16, 12), [0, 0.28, -0.16]), head, hc);
        break;
      case 'braids':
        crop(0.004);
        for (let i = 0; i < 7; i++) {
          const a = Math.PI + (i - 3) * 0.3;
          on(at(new THREE.CapsuleGeometry(0.024, 0.36, 3, 6), [Math.sin(a) * 0.245, -0.16, Math.cos(a) * 0.245], [1, 1, 1], [Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12]), head, hc, false);
        }
        break;
      case 'low':
        crop();
        break;
      case 'bald':
        break;
    }

  // ------------------------------------------------------------ bottoms

  const tucked = top.style === 'shirt';
  const lower = (side: number) => (y: number) => leg(side)(y);
  let skirt = false;
  if (bottom.style === 'trousers' || bottom.style === 'shorts') {
    const b = bottom.color;
    layer(['torso'], 0.022, { top: 1.03, bottom: 0.71, ring: grown(torso, 0.022), weight: torsoW, segs: 24, capBottom: true, inner: torso }, b);
    const hemY = bottom.style === 'shorts' ? 0.55 : 0.07;
    for (const l of rig.legs) {
      const flare = bottom.style === 'shorts' ? (y: number) => Math.max(0, 0.66 - y) * 0.12 : (y: number) => Math.max(0, 0.3 - y) * 0.06;
      layer([`leg${l.side}`], 0.02, { top: 0.92, bottom: hemY, ring: grown(lower(l.side), 0.02, flare), weight: legW(l), segs: 14, inner: lower(l.side) }, b);
      if (bottom.style === 'shorts') layer([`leg${l.side}`], 0.034, { top: hemY + 0.045, bottom: hemY, ring: grown(lower(l.side), 0.034, flare), weight: legW(l), segs: 14, inner: lower(l.side) }, shade(b, 0.12));
    }
    // Waistband and belt.
    layer(['torso'], 0.03, { top: 1.035, bottom: 0.985, ring: grown(torso, 0.03), weight: torsoW, segs: 24, inner: torso }, bottom.style === 'trousers' ? shade(INK, -0.1) : shade(b, 0.15), false);
    if (bottom.style === 'trousers' && tucked) on(at(new THREE.BoxGeometry(0.06, 0.045, 0.02), [0, 0.07, 0.2]), hips, 0xc9c4b0, false);
  } else if (bottom.style === 'wrapper') {
    // Ankara: cloth wrapped from the waist to the ankles, a printed band at the hem and a tuck at the front.
    skirt = true;
    const acc = trim(bottom, 0xf4f1e6);
    const wrap = (y: number): Ring => {
      const u = (1.04 - y) / 0.94;
      return { x: 0, z: -0.005, rx: 0.27 + u * 0.12, rz: 0.19 + u * 0.12 };
    };
    const print = (y: number, a: number) => {
      if (y < 0.24 && y > 0.16) return acc;
      const d = Math.sin(a * 9 + y * 34) * Math.sin(a * 9 - y * 34);
      return d > 0.55 ? acc : null;
    };
    layer(['torso', 'leg-1', 'leg1'], 0.05, { top: 1.04, bottom: 0.1, ring: wrap, weight: chain(rig, [[1.0, hips]]), segs: 28, step: 0.03, inner: torso, paint: print }, bottom.color);
    on(at(new THREE.SphereGeometry(0.06, 10, 8), [0.06, 0.08, 0.2], [1.2, 0.8, 0.6]), hips, bottom.color);
    // Legs still show below the hem, in skin.
  }

  // ------------------------------------------------------------ tops

  const t = top.color;
  const acc = trim(top, shade(t, 0.15));
  const armUnder = (side: number) => (y: number) => arm(side)(y);
  /** A sleeve over the top of the arm, down to y, flaring by `flare` metres at the cuff. */
  const sleeve = (l: Limb, to: number, by: number, flare = 0, color = t) => {
    const from = 1.63;
    const f = (y: number) => flare * THREE.MathUtils.clamp((from - 0.1 - y) / (from - 0.1 - to), 0, 1) ** 2;
    layer([`arm${l.side}`], by, { top: from, bottom: to, ring: grown(armUnder(l.side), by, f), weight: armW(l), segs: 14, capTop: true, inner: armUnder(l.side) }, color);
    return (y: number) => grown(armUnder(l.side), by + 0.012, f)(y);
  };

  switch (top.style) {
    case 'tee': {
      layer(['torso'], 0.04, { top: 1.76, bottom: 0.86, ring: grown(torso, 0.04, (y) => Math.max(0, 1.0 - y) * 0.08), weight: torsoW, segs: 24, inner: torso }, t);
      for (const l of rig.arms) sleeve(l, 1.42, 0.022, 0.03);
      // Ribbed crew neck.
      layer(['neck'], 0.022, { top: 1.79, bottom: 1.74, ring: grown(neck, 0.022), weight: neckW, segs: 16, inner: neck }, acc, false);
      break;
    }
    case 'singlet': {
      // Scoop neck, deep armholes, and broad straps over the shoulders: one piece, cut to shape.
      const singlet = (a: number) => {
        const side = Math.abs(Math.cos(a));
        const neck = Math.sin(a) > 0 ? 1.6 : 1.66;
        const base = side < 0.5 ? neck : 1.42;
        const strap = THREE.MathUtils.smoothstep(0.1 - Math.abs(side - 0.55), 0, 0.05);
        return base + (1.8 - base) * strap;
      };
      layer(['torso'], 0.04, { top: 1.78, bottom: 0.86, ring: grown(torso, 0.04, (y) => Math.max(0, 1.0 - y) * 0.06), weight: torsoW, segs: 40, step: 0.025, inner: torso, cut: singlet }, t);
      break;
    }
    case 'shirt': {
      // Tucked in: under the trousers' waistband.
      layer(['torso'], 0.012, { top: 1.76, bottom: 0.95, ring: grown(torso, 0.012), weight: torsoW, segs: 24, inner: torso }, t);
      for (const l of rig.arms) {
        const cuffAt = sleeve(l, 0.95, 0.018, 0.006);
        layer([`arm${l.side}`], 0.03, { top: 1.0, bottom: 0.94, ring: cuffAt, weight: armW(l), segs: 14, inner: armUnder(l.side) }, acc === t ? shade(t, 0.08) : t, false);
      }
      // Collar stand and points, placket and buttons, breast pocket.
      layer(['neck'], 0.024, { top: 1.86, bottom: 1.74, ring: grown(neck, 0.024, (y) => Math.max(0, 1.8 - y) * 0.25), weight: neckW, segs: 16, inner: neck }, t);
      for (const sx of [-1, 1]) on(at(new THREE.BoxGeometry(0.1, 0.012, 0.075), [sx * 0.06, 0.82, 0.135], [1, 1, 1], [-1.0, sx * 0.55, sx * -0.35]), chest, t);
      on(at(new THREE.BoxGeometry(0.045, 0.6, 0.012), [0, 0.43, 0.205]), chest, shade(t, 0.06), false);
      for (let i = 0; i < 5; i++) on(at(new THREE.SphereGeometry(0.009, 6, 4), [0, 0.7 - i * 0.12, 0.214]), chest, acc, false);
      on(at(new THREE.BoxGeometry(0.1, 0.11, 0.012), [-0.13, 0.55, 0.2], [1, 1, 1], [0.08, -0.25, 0]), chest, shade(t, 0.05), false);
      break;
    }
    case 'buba': {
      // Loose, over the trousers to the upper thigh; wide sleeves to the forearm.
      const loose = grown(torso, 0.045, (y) => Math.max(0, 1.1 - y) * 0.2);
      layer(['torso'], 0.045, { top: 1.77, bottom: 0.68, ring: loose, weight: torsoW, segs: 26, inner: torso }, t);
      layer(['torso'], 0.053, { top: 0.73, bottom: 0.68, ring: grown(loose, 0.008), weight: torsoW, segs: 26, inner: torso }, acc, false);
      for (const l of rig.arms) sleeve(l, 1.1, 0.03, 0.08);
      // Embroidered neck: a keyhole panel down the chest, and a band round the neckline.
      layer(['neck'], 0.03, { top: 1.79, bottom: 1.74, ring: grown(neck, 0.03), weight: neckW, segs: 16, inner: neck }, acc, false);
      on(at(new THREE.CapsuleGeometry(0.05, 0.22, 4, 8), [0, 0.6, 0.198], [1, 1, 0.25]), chest, acc, false);
      on(at(new THREE.CapsuleGeometry(0.03, 0.18, 4, 8), [0, 0.6, 0.207], [1, 1, 0.25]), chest, shade(t, 0.15), false);
      break;
    }
    case 'kaftan': {
      // Long: chest to shin. Below the waist it hangs from the hips, so legs swing inside it.
      skirt = true;
      // Falls straight from the chest, clear of the hips and anything worn under it.
      const body = (y: number): Ring => {
        const r = grown(torso, 0.04)(y);
        if (y > 1.15) return r;
        const u = THREE.MathUtils.smoothstep(1.15 - y, 0, 0.95);
        const top = grown(torso, 0.04)(1.15);
        return { ...r, rx: Math.max(r.rx + 0.05, THREE.MathUtils.lerp(top.rx, 0.47, u)), rz: Math.max(r.rz + 0.05, THREE.MathUtils.lerp(top.rz, 0.42, u)) };
      };
      const kw = chain(rig, [
        [1.15, chest],
        [0.95, hips],
      ]);
      layer(['torso', 'leg-1', 'leg1'], 0.04, { top: 1.77, bottom: 0.2, ring: body, weight: kw, segs: 26, step: 0.04, inner: torso }, t);
      layer(['torso', 'leg-1', 'leg1'], 0.048, { top: 0.26, bottom: 0.2, ring: grown(body, 0.008), weight: kw, segs: 26, inner: torso }, acc, false);
      for (const l of rig.arms) sleeve(l, 0.95, 0.026, 0.05);
      layer(['neck'], 0.028, { top: 1.79, bottom: 1.74, ring: grown(neck, 0.028), weight: neckW, segs: 16, inner: neck }, acc, false);
      on(at(new THREE.CapsuleGeometry(0.045, 0.32, 4, 8), [0, 0.55, 0.2], [1, 1, 0.25]), chest, acc, false);
      break;
    }
  }

  // ------------------------------------------------------------ shoes

  for (const l of rig.legs) {
    const s = shoes.color;
    const bare = shoes.style === 'slippers' || shoes.style === 'sandals';
    if (bare) {
      // The foot itself: heel and forefoot, with a toe ridge.
      on(at(new THREE.SphereGeometry(0.05, 10, 8), [0, -0.025, -0.035], [1, 0.85, 1.1]), l.end, skin);
      on(at(new THREE.SphereGeometry(0.06, 12, 8), [0, -0.03, 0.07], [1, 0.55, 1.65]), l.end, skin);
    }
    switch (shoes.style) {
      case 'slippers':
        on(at(sole(0.022), [0, -0.05, 0]), l.end, trim(shoes, s));
        on(at(new THREE.TorusGeometry(0.058, 0.02, 6, 14, Math.PI), [0, -0.05, 0.075], [1, 0.9, 2]), l.end, s);
        break;
      case 'sandals':
        on(at(sole(0.014), [0, -0.054, 0]), l.end, s);
        for (const r of [-0.45, 0.45]) on(at(new THREE.TorusGeometry(0.058, 0.009, 4, 12, Math.PI), [0, -0.055, 0.065], [1, 0.9, 1], [0, r, 0]), l.end, shade(s, 0.1), false);
        on(at(new THREE.TorusGeometry(0.052, 0.009, 4, 12, Math.PI), [0, -0.04, -0.035], [1, 1, 1], [0, Math.PI / 2, 0]), l.end, shade(s, 0.1), false);
        break;
      case 'sneakers': {
        const a = trim(shoes, 0xf4f1e6);
        on(at(sole(0.03, 0.006), [0, -0.035, 0]), l.end, a);
        on(at(new THREE.SphereGeometry(0.07, 14, 10), [0, -0.02, 0.04], [1, 0.75, 1.9]), l.end, s);
        on(at(new THREE.CylinderGeometry(0.062, 0.068, 0.07, 12), [0, 0.0, -0.035]), l.end, s);
        for (let i = 0; i < 3; i++) on(at(new THREE.BoxGeometry(0.06, 0.008, 0.012), [0, 0.03 - i * 0.012, 0.03 + i * 0.03], [1, 1, 1], [-0.5, 0, 0]), l.end, a, false);
        break;
      }
      case 'shoes':
        on(at(sole(0.016, 0.004), [0, -0.05, 0]), l.end, INK);
        on(at(new THREE.SphereGeometry(0.066, 14, 10), [0, -0.022, 0.045], [1, 0.62, 1.95]), l.end, s);
        on(at(new THREE.CylinderGeometry(0.058, 0.063, 0.06, 12), [0, -0.012, -0.035]), l.end, s);
        on(at(new THREE.BoxGeometry(0.09, 0.022, 0.06), [0, -0.062, -0.05]), l.end, INK, false);
        break;
    }
  }

  // ------------------------------------------------------------ hats

  if (hat) {
    const hcol = hat.color;
    const lift = body.hair === 'afro' ? 0.01 : 0;
    switch (hat.style) {
      case 'cap':
        on(at(new THREE.SphereGeometry(0.29, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.07 + lift, -0.005], [1, 1.02, 1.04], [-0.1, 0, 0]), head, hcol);
        on(at(new THREE.SphereGeometry(0.018, 6, 4), [0, 0.37 + lift, -0.03]), head, shade(hcol, 0.1), false);
        on(at(new THREE.CylinderGeometry(0.17, 0.17, 0.018, 16, 1, false, -Math.PI / 2, Math.PI), [0, 0.09 + lift, 0.24], [1.15, 1, 1.25], [0.14, 0, 0]), head, shade(hcol, 0.08));
        break;
      case 'beanie':
        on(at(new THREE.SphereGeometry(0.295, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.07 + lift, -0.01], [1, 1.2, 1.02]), head, hcol);
        on(at(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 24), [0, 0.09 + lift, -0.01], [1, 1, 1.02]), head, hat.accent ?? shade(hcol, 0.1));
        break;
      case 'kufi':
        on(at(new THREE.CylinderGeometry(0.27, 0.285, 0.15, 24), [0, 0.19 + lift, -0.01]), head, hcol);
        on(at(new THREE.SphereGeometry(0.27, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.265 + lift, -0.01], [1, 0.22, 1]), head, hcol);
        break;
      case 'fila':
        // Soft and tall, folded over to one side.
        on(at(new THREE.CylinderGeometry(0.27, 0.29, 0.22, 24), [0.02, 0.24 + lift, -0.01], [1, 1, 1], [0, 0, -0.14]), head, hcol);
        on(at(new THREE.SphereGeometry(0.2, 16, 10), [0.11, 0.35 + lift, -0.01], [1.1, 0.45, 1.25], [0, 0, -0.5]), head, shade(hcol, 0.06));
        break;
      case 'headtie': {
        // Gele: a wrapped crown with stiff pleats fanning up at the back.
        on(at(new THREE.SphereGeometry(0.33, 24, 14), [0, 0.16 + lift, -0.02], [1.06, 0.72, 1.05]), head, hcol);
        const pleat = shade(hcol, 0.08);
        for (let i = -2; i <= 2; i++)
          on(at(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16, 1, false, 0, Math.PI), [i * 0.06, 0.3 + lift, -0.12], [1, 1, 1], [Math.PI / 2 - 0.55, i * 0.25, 0]), head, i % 2 ? pleat : hcol);
        break;
      }
    }
  }

  for (const l of layers) {
    const pos = l.geo.getAttribute('position');
    const bare = l.geo.getAttribute('bare') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (layers.some((o) => o.by > l.by && o.on.some((c) => l.on.includes(c)) && y <= o.top && y >= o.bottom)) bare.setX(i, 0);
    }
  }

  return { parts, skirt };
}
