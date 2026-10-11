import * as THREE from 'three';
import { Kit, box, cyl, pyramid } from './kit';
import { Rng as RngLite, type Rng } from './rng';

// Building and prop kits, authored flat in local space (front faces +z), bent onto the planet later.

export const HOUSE_PAINTS = [0xe9ecdf, 0xd8d3c4, 0xdcb9b0, 0xb9c9b8, 0xe6d9b8, 0xc8d6d6];
export const ROOFS = [0x5d86a8, 0xb5564c, 0x5f8f6a, 0x9a6b4f, 0x8a9a96, 0x4f8f8a, 0xa59d92, 0x9a8f95];
export const WALL_PAINTS = [0xdfe2d4, 0xcfd2c3, 0xd9cfbf, 0xc9d1c4];
export const GATES = [0x4c6f7a, 0x4d7357, 0x7a4a46, 0x3d4444];
export const CITY_PAINTS = [0xe8ebe0, 0xd5d9cf, 0xc7cfca, 0xdcc9bc, 0xbfd3cc, 0xe3dcc6, 0xcdc5cc];
export const ACCENTS = [0xc9584d, 0x5b8fb0, 0xd9b44a, 0x5f9e6e, 0x8fd3b8];
export const KIOSKS = [0xd9b44a, 0x5b8fb0, 0xc9584d, 0x5f9e6e];
export const GLASS = 0x3e4c52;

// --- Weathering: nothing in Lagos stays freshly painted for long. ---
const GRIME = 0x8f8a7c;
const BLOCK = 0xb5b2a4; // bare sandcrete block where the plaster has gone
const RUST = 0x8a5a44;
/** Faded, slightly-off colours used for repainted patches. */
const MISMATCH = [0xd9c27a, 0x9fc0b0, 0xc9a39a, 0xa9b8c9, 0xe0d6c0, 0xb5c49a, 0xd8b98f];
export const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
/** Paint that has had a few rainy seasons. */
export const aged = (rng: Rng, paint: number) => mix(paint, GRIME, rng.range(0.1, 0.35));
/** Zinc sheets that were replaced one at a time: per-face mismatched colours with rust. */
export const zincSheets = (rng: Rng, roof: number) =>
  Array.from({ length: 6 }, () => (rng.chance(0.3) ? mix(roof, RUST, rng.range(0.5, 0.9)) : rng.chance(0.3) ? mix(roof, 0xa9aca6, 0.5) : mix(roof, GRIME, rng.range(0, 0.25))));

/**
 * Wear on a box-shaped building (w x h x d, base at y0): damp band, rain streaks, repainted
 * patches in mismatched colours, bare blockwork and cracks, on all four walls.
 */
export function weather(k: Kit, rng: Rng, w: number, h: number, d: number, y0: number, paint: number, amount = 1.3): void {
  k.add(box(w + 0.03, 0.55, d + 0.03), mix(paint, 0x6f6a5c, 0.45), [0, y0 + 0.28, 0]);
  const faces = [
    { nx: 0, nz: 1, len: w },
    { nx: 0, nz: -1, len: w },
    { nx: 1, nz: 0, len: d },
    { nx: -1, nz: 0, len: d },
  ];
  const put = (f: (typeof faces)[number], u: number, y: number, sw: number, sh: number, color: number, lift = 0) => {
    const t = 0.03;
    if (f.nz !== 0) k.add(box(sw, sh, t), color, [u, y, f.nz * (d / 2 + 0.016 + lift)]);
    else k.add(box(t, sh, sw), color, [f.nx * (w / 2 + 0.016 + lift), y, u]);
  };
  for (const f of faces) {
    const half = f.len / 2;
    if (half < 0.8) continue;
    // Rain streaks running down from the roof edge.
    for (let i = 0, n = Math.round(rng.int(1, 3) * amount); i < n; i++) {
      const sh = rng.range(0.6, Math.min(2.2, h * 0.6));
      put(f, rng.range(-half + 0.3, half - 0.3), y0 + h - sh / 2 - 0.02, rng.range(0.12, 0.3), sh, mix(paint, GRIME, rng.range(0.3, 0.5)));
    }
    // A repainted patch that never quite matched.
    if (rng.chance(0.55 * amount)) {
      const sw = Math.min(half, rng.range(0.8, 2.4));
      const sh = Math.max(0.4, Math.min(rng.range(0.6, 2), h - 1.2));
      put(f, rng.range(-half + sw / 2, half - sw / 2), y0 + rng.range(0.7 + sh / 2, Math.max(0.71 + sh / 2, h - sh / 2 - 0.2)), sw, sh, rng.chance(0.4) ? mix(paint, 0xffffff, 0.2) : rng.pick(MISMATCH), 0.005);
    }
    // Plaster gone: bare blockwork with mortar lines.
    if (rng.chance(0.35 * amount)) {
      const sw = rng.range(0.5, 1.3);
      const sh = rng.range(0.45, 1);
      const u = rng.range(-half + sw / 2, half - sw / 2);
      const y = y0 + rng.range(0.6 + sh / 2, Math.max(0.61 + sh / 2, h - sh / 2 - 0.2));
      put(f, u, y, sw, sh, BLOCK, 0.01);
      for (let r = 1; r < 3; r++) put(f, u, y - sh / 2 + (r * sh) / 3, sw, 0.035, mix(BLOCK, 0x5f5a50, 0.4), 0.02);
    }
    // A crack.
    if (rng.chance(0.3 * amount)) {
      const u = rng.range(-half + 0.5, half - 0.5);
      const y = y0 + rng.range(1, Math.max(1.1, h - 0.5));
      put(f, u, y, 0.04, rng.range(0.4, 0.8), 0x4f4a42, 0.012);
      put(f, u + 0.12, y - 0.4, 0.04, rng.range(0.3, 0.5), 0x4f4a42, 0.012);
    }
  }
}

/** Rooftop and yard clutter that makes Lagos read as Lagos. */
export function satelliteDish(k: Kit, x: number, y: number, z: number, yaw = 0): void {
  k.add(cyl(0.03, 0.03, 0.5, 5), 0x555555, [x, y + 0.25, z]);
  k.add(new THREE.CylinderGeometry(0.42, 0.12, 0.14, 12), 0xd8dbd2, [x, y + 0.62, z], { rot: [0.9, yaw, 0] });
}

export function antenna(k: Kit, x: number, y: number, z: number, h = 2.2): void {
  k.add(cyl(0.03, 0.04, h, 5), 0x4a4a4a, [x, y + h / 2, z]);
  for (let i = 0; i < 3; i++) k.add(box(0.7 - i * 0.15, 0.03, 0.03), 0x4a4a4a, [x, y + h * (0.6 + i * 0.15), z]);
}

export function acUnit(k: Kit, x: number, y: number, z: number): void {
  k.add(box(0.7, 0.45, 0.25), 0xd8dbd2, [x, y, z]);
  k.add(box(0.5, 0.3, 0.02), 0x9aa49c, [x, y, z + 0.13]);
}

/** Overhead water tank on a steel stand: in half the compounds in Lagos. */
export function tankTower(color = 0x2b5aa8): Kit {
  const k = new Kit();
  for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) k.add(cyl(0.05, 0.05, 3, 5), 0x6b6f6c, [x, 1.5, z]);
  for (const y of [1, 2]) {
    k.add(box(1.3, 0.05, 0.05), 0x6b6f6c, [0, y, -0.6]);
    k.add(box(1.3, 0.05, 0.05), 0x6b6f6c, [0, y, 0.6]);
  }
  k.add(box(1.5, 0.1, 1.5), 0x6b6f6c, [0, 3.05, 0]);
  k.add(cyl(0.75, 0.75, 1.5, 12), color, [0, 3.85, 0]);
  k.add(cyl(0.2, 0.2, 0.12, 8), color, [0, 4.65, 0]);
  return k;
}

/** Borehole: a pump head on a little concrete plinth with a tap. */
export function borehole(): Kit {
  const k = new Kit();
  k.add(box(1, 0.3, 1), 0xc4c6b8, [0, 0.15, 0]);
  k.add(cyl(0.12, 0.12, 0.9, 8), 0x5b8fb0, [0, 0.75, 0]);
  k.add(box(0.5, 0.06, 0.06), 0x5b8fb0, [0.2, 1.05, 0]);
  return k;
}

function windowWithBars(k: Kit, x: number, y: number, z: number, w = 1.2, h = 1): void {
  k.add(box(w, h, 0.08), 0x46606e, [x, y, z]);
  for (let i = 1; i < 4; i++) k.add(box(0.04, h, 0.04), 0x2f3a3a, [x - w / 2 + (i * w) / 4, y, z + 0.05]);
}

/** Gabled zinc roof: a triangular prism along x. */
function gableRoof(k: Kit, w: number, d: number, y: number, color: number, rise = 1.4, sheets?: number[]): void {
  const prism = new THREE.CylinderGeometry(1, 1, 1, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6);
  k.add(prism, color, [0, y + rise * 0.5, 0], { scale: [w * 1.12, rise, d * 0.62], flat: true, faceColors: sheets });
}

export type HouseStyle = 'hip' | 'gable' | 'storey' | 'faceme';

/** Suburban house in one of several common Nigerian styles. */
export function houseKit(rng: Rng, w: number, d: number, style: HouseStyle = rng.pick(['hip', 'hip', 'gable', 'storey', 'faceme'] as const)): Kit {
  const k = new Kit();
  const paint = aged(rng, rng.pick(HOUSE_PAINTS));
  const roof = rng.pick(ROOFS);
  const sheets = zincSheets(rng, roof);
  const front = d / 2;
  k.add(box(w + 0.3, 0.4, d + 0.3), 0xb8ab95, [0, 0.2, 0]);
  switch (style) {
    case 'hip':
      k.add(box(w, 3, d), paint, [0, 1.9, 0]);
      weather(k, rng, w, 3, d, 0.4, paint);
      k.add(pyramid(), roof, [0, 4.3, 0], { scale: [w * 1.2, 1.8, d * 1.2], flat: true, faceColors: sheets });
      k.add(box(1.1, 2.1, 0.1), 0x6b4a2f, [0, 1.45, front + 0.05]);
      windowWithBars(k, -w * 0.3, 2, front + 0.04);
      windowWithBars(k, w * 0.3, 2, front + 0.04);
      break;
    case 'gable': {
      k.add(box(w, 3, d), paint, [0, 1.9, 0]);
      weather(k, rng, w, 3, d, 0.4, paint);
      gableRoof(k, w, d, 3.4, roof, 1.4, sheets);
      // Veranda: slim pillars holding a lean-to zinc roof.
      for (const x of [-w / 2 + 0.3, 0, w / 2 - 0.3]) k.add(box(0.22, 2.6, 0.22), 0xe9ecdf, [x, 1.7, front + 1.4]);
      k.add(box(w + 0.2, 0.1, 1.8), roof, [0, 3.05, front + 0.85], { rot: [0.12, 0, 0] });
      k.add(box(1.1, 2.1, 0.1), 0x4d7357, [0, 1.45, front + 0.05]);
      windowWithBars(k, -w * 0.3, 2, front + 0.04);
      windowWithBars(k, w * 0.3, 2, front + 0.04);
      break;
    }
    case 'storey': {
      // "Storey building": two floors, flat roof with parapet, balcony over the door.
      k.add(box(w, 6, d), paint, [0, 3.4, 0]);
      if (rng.chance(0.35)) k.add(box(w + 0.02, 3, d + 0.02), aged(rng, rng.pick(HOUSE_PAINTS)), [0, 4.9, 0]); // upstairs painted later, different colour
      weather(k, rng, w, 6, d, 0.4, paint);
      k.add(box(w + 0.2, 0.35, d + 0.2), mix(0xe9e4da, 0x8f8a7c, rng.range(0.1, 0.4)), [0, 6.55, 0]);
      for (let i = 0; i < 2; i++) k.add(box(rng.range(1, 2.5), 0.02, rng.range(1, 2.5)), mix(0x8f8a7c, 0x6f6a5c, rng.next()), [rng.range(-w / 4, w / 4), 6.74, rng.range(-d / 4, d / 4)]);
      k.add(box(w * 0.6, 0.15, 1.3), 0xd8dbd2, [0, 3.5, front + 0.65]);
      for (let i = 0; i <= 6; i++) k.add(box(0.05, 0.9, 0.05), 0x3d4444, [-w * 0.3 + (i * w * 0.6) / 6, 4, front + 1.25]);
      k.add(box(w * 0.6, 0.06, 0.06), 0x3d4444, [0, 4.45, front + 1.25]);
      k.add(box(1.1, 2.1, 0.1), 0x6b4a2f, [0, 1.45, front + 0.05]);
      for (const y of [2, 5]) {
        windowWithBars(k, -w * 0.32, y, front + 0.04);
        windowWithBars(k, w * 0.32, y, front + 0.04);
      }
      k.add(cyl(0.6, 0.6, 1.3, 10), rng.pick([0x2a2a2a, 0x2b5aa8]), [w * 0.25, 7.4, -d * 0.2]);
      if (rng.chance(0.6)) satelliteDish(k, -w * 0.3, 6.7, -d * 0.2);
      acUnit(k, w / 2 + 0.15, 4.6, 0);
      break;
    }
    case 'faceme': {
      // Face-me-I-face-you: a long block of rooms, several doors along the front.
      k.add(box(w, 2.9, d), paint, [0, 1.85, 0]);
      weather(k, rng, w, 2.9, d, 0.4, paint, 1.3);
      k.add(pyramid(), roof, [0, 4.05, 0], { scale: [w * 1.15, 1.3, d * 1.2], flat: true, faceColors: sheets });
      const doors = Math.max(3, Math.floor(w / 2.4));
      for (let i = 0; i < doors; i++) {
        const x = -w / 2 + ((i + 0.5) * w) / doors;
        k.add(box(0.9, 2, 0.1), rng.pick([0x6b4a2f, 0x4c6f7a, 0x7a4a46]), [x, 1.4, front + 0.05]);
        if (rng.chance(0.4)) k.add(box(0.8, 0.6, 0.04), rng.pick([0xc9584d, 0xd9b44a, 0x5b8fb0]), [x, 2.6, front + 0.1]); // curtain
      }
      break;
    }
  }
  k.add(box(1.6, 0.2, 0.6), 0xb8ab95, [0, 0.1, front + 0.4]);
  if (style !== 'storey' && rng.chance(0.35)) antenna(k, -w * 0.35, 4.2, -d * 0.2);
  return k;
}

/** City block with variety: set-back top floors, balconies, outside stairs, rooftop clutter, unfinished floors. */
export function cityKit(rng: Rng, w: number, d: number, floors: number, base = rng.pick(CITY_PAINTS)): Kit {
  const k = new Kit();
  const FH = 3.2;
  const paint = aged(rng, base);
  const accent = mix(rng.pick(ACCENTS), GRIME, rng.range(0.1, 0.35));
  const setback = floors >= 3 && rng.chance(0.35);
  const fullFloors = setback ? floors - 1 : floors;
  const h = fullFloors * FH;
  k.add(box(w, h, d), paint, [0, h / 2, 0]);
  // Upper floors added years later, in whatever paint was going.
  if (fullFloors >= 2 && rng.chance(0.4)) {
    const split = FH * rng.int(1, fullFloors - 1);
    k.add(box(w + 0.02, h - split, d + 0.02), aged(rng, rng.pick([...CITY_PAINTS, ...MISMATCH])), [0, split + (h - split) / 2, 0]);
  }
  weather(k, rng, w, h, d, 0, paint);
  // Ground-floor shops: shutters and a sloping awning.
  const shops = w > 8.5 ? 2 : 1;
  for (let i = 0; i < shops; i++) {
    const sw = (w * 0.86) / shops;
    const x = -w * 0.43 + sw * (i + 0.5);
    const shutter = rng.pick([0x2f3a40, 0x6a6e6c, RUST, mix(0x6a6e6c, RUST, 0.5)]);
    k.add(box(sw - 0.2, 2.3, 0.1), shutter, [x, 1.25, d / 2 + 0.06]);
    for (let j = 1; j < 5; j++) k.add(box(sw - 0.3, 0.03, 0.02), mix(shutter, 0xffffff, 0.15), [x, 0.3 + j * 0.42, d / 2 + 0.12]);
    k.add(box(sw - 0.05, 0.12, 1.5), mix(rng.pick(ACCENTS), GRIME, rng.range(0.15, 0.45)), [x, 2.75, d / 2 + 0.7], { rot: [0.28, 0, 0] });
  }
  const balconies = rng.chance(0.4);
  for (let f = 1; f < fullFloors; f++) {
    const y = f * FH + 1.6;
    if (balconies) {
      k.add(box(w * 0.7, 0.14, 1.1), 0xd8dbd2, [0, f * FH + 0.1, d / 2 + 0.55]);
      for (let i = 0; i <= 8; i++) k.add(box(0.04, 0.85, 0.04), 0x3d4444, [-w * 0.35 + (i * w * 0.7) / 8, f * FH + 0.55, d / 2 + 1.05]);
      k.add(box(w * 0.7, 0.05, 0.05), 0x3d4444, [0, f * FH + 0.98, d / 2 + 1.05]);
    }
    k.add(box(w * 0.8, 1, 0.08), GLASS, [0, y, d / 2 + 0.04]);
    if (rng.chance(0.4)) acUnit(k, w * rng.range(-0.3, 0.3), y - 0.9, d / 2 + 0.2);
  }
  // Outside staircase up one side.
  if (fullFloors >= 2 && rng.chance(0.3)) {
    const side = rng.chance(0.5) ? -1 : 1;
    for (let f = 0; f < fullFloors - 1; f++) {
      k.add(box(1, 0.2, d * 0.7), 0xc4c6b8, [side * (w / 2 + 0.5), f * FH + FH / 2 + 0.2, 0], { rot: [side * 0.55, 0, 0] });
    }
    k.add(box(0.05, h - FH, 0.05), 0x3d4444, [side * (w / 2 + 1), (h - FH) / 2 + 1, d * 0.3]);
  }
  let roofY = h;
  if (setback) {
    const sw = w * 0.65;
    const sd = d * 0.7;
    k.add(box(sw, FH, sd), paint, [-w * 0.1, h + FH / 2, -d * 0.12]);
    k.add(box(sw * 0.8, 1, 0.08), GLASS, [-w * 0.1, h + 1.6, -d * 0.12 + sd / 2 + 0.04]);
    for (let i = 0; i <= 10; i++) k.add(box(0.04, 0.8, 0.04), 0x3d4444, [-w / 2 + (i * w) / 10, h + 0.4, d / 2 - 0.1]);
    roofY = h + FH;
  }
  k.add(box(w + 0.2, 0.35, d + 0.2), mix(0xe9e4da, GRIME, rng.range(0.1, 0.45)), [0, h + 0.17, 0]);
  // Water stains on the flat roof.
  for (let i = 0; i < rng.int(2, 4); i++) {
    // Irregular: two overlapping smaller stains in a slightly darker roof tone.
    const sx = rng.range(-w / 3, w / 3);
    const sz = rng.range(-d / 3, d / 3);
    const tone = mix(0xe9e4da, GRIME, rng.range(0.45, 0.75));
    k.add(box(rng.range(0.6, w * 0.3), 0.02, rng.range(0.6, d * 0.3)), tone, [sx, h + 0.36, sz]);
    k.add(box(rng.range(0.4, w * 0.2), 0.02, rng.range(0.4, d * 0.2)), tone, [sx + rng.range(-0.6, 0.6), h + 0.361, sz + rng.range(-0.6, 0.6)]);
  }
  if (rng.chance(0.25)) {
    // Unfinished next floor: bare columns waiting for money to continue building.
    for (const [x, z] of [[-w / 2 + 0.3, -d / 2 + 0.3], [w / 2 - 0.3, -d / 2 + 0.3], [-w / 2 + 0.3, d / 2 - 0.3], [w / 2 - 0.3, d / 2 - 0.3], [0, d / 2 - 0.3]] as const) {
      k.add(box(0.35, 1.4, 0.35), 0xb9b6a8, [x, roofY + 0.7, z]);
      k.add(cyl(0.02, 0.02, 0.6, 4), 0x6b4a3a, [x + 0.08, roofY + 1.7, z]);
      k.add(cyl(0.02, 0.02, 0.6, 4), 0x6b4a3a, [x - 0.08, roofY + 1.7, z]);
    }
  } else {
    if (rng.chance(0.65)) k.add(box(w * 0.6, 1.1, 0.25), accent, [0, roofY + 0.9, d / 2 - 0.4]);
    if (rng.chance(0.8)) k.add(cyl(0.7, 0.7, 1.5, 10), rng.pick([0x2a2a2a, 0x2b5aa8]), [rng.range(-w / 3, w / 3), roofY + 1.1, rng.range(-d / 4, 0)]);
    if (rng.chance(0.5)) satelliteDish(k, rng.range(-w / 3, w / 3), roofY + 0.3, -d / 3);
    if (rng.chance(0.4)) antenna(k, rng.range(-w / 3, w / 3), roofY + 0.3, -d / 3, rng.range(2, 4));
  }
  return k;
}

/** Church: hall with a gabled roof, front tower and cross. Fictional congregation. */
export function churchKit(): Kit {
  const k = new Kit();
  const w = 9;
  const d = 13;
  k.add(box(w + 0.4, 0.4, d + 0.4), 0xb8ab95, [0, 0.2, 0]);
  k.add(box(w, 5, d), 0xe9ecdf, [0, 2.9, 0]);
  weather(k, new RngLite(31), w, 5, d, 0.4, 0xe9ecdf, 0.6);
  gableRoof(k, d, w, 5.4, 0x5d86a8, 2.4);
  // Turn the gable to run front-to-back.
  const roof = k.parts.pop()!;
  roof.rotateY(Math.PI / 2);
  k.parts.push(roof);
  for (let i = 0; i < 4; i++) {
    k.add(box(0.12, 2.2, 1), 0x6f9ac0, [w / 2 + 0.05, 2.8, -d / 2 + 2 + i * 3]);
    k.add(box(0.12, 2.2, 1), 0x6f9ac0, [-w / 2 - 0.05, 2.8, -d / 2 + 2 + i * 3]);
  }
  k.add(box(3, 9, 3), 0xe9ecdf, [0, 4.5, d / 2 + 1.2]);
  k.add(pyramid(), 0x5d86a8, [0, 9.9, d / 2 + 1.2], { scale: [3.4, 1.8, 3.4], flat: true });
  k.add(box(0.2, 1.6, 0.2), 0xd9b44a, [0, 11.6, d / 2 + 1.2]);
  k.add(box(0.9, 0.2, 0.2), 0xd9b44a, [0, 11.9, d / 2 + 1.2]);
  k.add(box(1.6, 2.6, 0.1), 0x6b4a2f, [0, 1.7, d / 2 + 2.75]);
  k.add(cyl(0.6, 0.6, 0.1, 16), 0x6f9ac0, [0, 6.4, d / 2 + 2.75], { rot: [Math.PI / 2, 0, 0] });
  return k;
}

/** Mosque: prayer hall, central dome and a minaret. Fictional congregation. */
export function mosqueKit(): Kit {
  const k = new Kit();
  const w = 10;
  const d = 10;
  k.add(box(w + 0.4, 0.4, d + 0.4), 0xb8ab95, [0, 0.2, 0]);
  k.add(box(w, 4.6, d), 0xeef0e6, [0, 2.7, 0]);
  weather(k, new RngLite(47), w, 4.6, d, 0.4, 0xeef0e6, 0.6);
  k.add(box(w + 0.3, 0.3, d + 0.3), 0x5f9e6e, [0, 5.1, 0]);
  k.add(cyl(2.6, 2.8, 1, 16), 0xeef0e6, [0, 5.7, 0]);
  k.add(new THREE.SphereGeometry(2.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x5f9e6e, [0, 6.2, 0]);
  k.add(cyl(0.05, 0.05, 1, 5), 0xd9b44a, [0, 9.2, 0]);
  k.add(new THREE.SphereGeometry(0.18, 8, 6), 0xd9b44a, [0, 9.75, 0]);
  for (let i = 0; i < 3; i++) k.add(box(1, 2.2, 0.1), 0x5f9e6e, [-3 + i * 3, 2.4, d / 2 + 0.05]);
  k.add(cyl(0.7, 0.8, 12, 10), 0xeef0e6, [w / 2 - 0.4, 6.2, d / 2 - 0.4]);
  k.add(cyl(1, 1, 0.3, 10), 0x5f9e6e, [w / 2 - 0.4, 10.5, d / 2 - 0.4]);
  k.add(new THREE.SphereGeometry(0.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x5f9e6e, [w / 2 - 0.4, 12.2, d / 2 - 0.4]);
  k.add(cyl(0.04, 0.04, 0.8, 5), 0xd9b44a, [w / 2 - 0.4, 13.2, d / 2 - 0.4]);
  return k;
}

export function danfoKit(): Kit {
  const k = new Kit();
  k.add(box(2.1, 1.9, 4.8), 0xe3b843, [0, 1.25, 0]);
  k.add(box(2.14, 0.18, 4.84), 0x1d1d1d, [0, 1, 0]);
  k.add(box(2.14, 0.18, 4.84), 0x1d1d1d, [0, 1.55, 0]);
  k.add(box(2.15, 0.55, 3.6), 0x33414a, [0, 1.85, -0.3]);
  k.add(box(1.9, 0.7, 0.05), 0x33414a, [0, 1.75, 2.42]);
  for (const [x, z] of [[-1.05, -1.6], [1.05, -1.6], [-1.05, 1.6], [1.05, 1.6]] as const) {
    k.add(cyl(0.42, 0.42, 0.3, 10), 0x1d1d1d, [x, 0.42, z], { rot: [0, 0, Math.PI / 2] });
  }
  return k;
}

export function kekeKit(): Kit {
  const k = new Kit();
  k.add(box(1.3, 1.1, 2.1), 0x4f9e5a, [0, 0.95, 0]);
  k.add(box(1.4, 0.12, 2.2), 0xe3b843, [0, 1.95, 0]);
  for (const [x, z] of [[-0.6, -0.95], [0.6, -0.95], [-0.6, 0.95], [0.6, 0.95]] as const) {
    k.add(cyl(0.04, 0.04, 0.5), 0x333333, [x, 1.65, z]);
  }
  for (const [x, z] of [[0, 1.0], [-0.6, -0.7], [0.6, -0.7]] as const) {
    k.add(cyl(0.3, 0.3, 0.2, 8), 0x1d1d1d, [x, 0.3, z], { rot: [0, 0, Math.PI / 2] });
  }
  return k;
}

export function kioskKit(color: number): Kit {
  const k = new Kit();
  k.add(box(2.2, 2.2, 1.6), color, [0, 1.1, 0]);
  k.add(box(2.6, 0.15, 2), 0xf4efe4, [0, 2.3, 0.1]);
  k.add(box(1.6, 0.8, 0.05), 0x2f3a40, [0, 1.4, 0.82]);
  return k;
}

export function foodStallKit(): Kit {
  const k = new Kit();
  k.add(box(4, 2.4, 2.4), 0xdca06a, [0, 1.2, 0]);
  k.add(box(4.2, 1, 0.6), 0xb9825a, [0, 0.5, 1.4]);
  k.add(box(4.6, 0.15, 3), 0xc9584d, [0, 2.5, 0.2]);
  k.add(cyl(0.35, 0.3, 0.4, 10), 0x333333, [-1, 1.2, 1.4]);
  k.add(cyl(0.3, 0.3, 0.35, 10), 0x8a4b2a, [0.6, 1.18, 1.4]);
  for (const [x, color] of [[-3.2, 0xd9b44a], [3.2, 0x5b8fb0]] as const) {
    k.add(cyl(0.05, 0.05, 2.4), 0x555555, [x, 1.2, 1.5]);
    k.add(new THREE.ConeGeometry(1.6, 0.6, 8), color, [x, 2.6, 1.5]);
    k.add(box(2, 0.45, 0.5), 0x7a5e4a, [x, 0.22, 2.4]);
  }
  return k;
}

export function shelterKit(): Kit {
  const k = new Kit();
  for (const [x, z] of [[-2.4, -0.9], [2.4, -0.9], [-2.4, 0.9], [2.4, 0.9]] as const) {
    k.add(cyl(0.08, 0.08, 2.6), 0x555555, [x, 1.3, z]);
  }
  k.add(box(5.4, 0.15, 2.4), 0xe3b843, [0, 2.65, 0]);
  k.add(box(4, 0.4, 0.5), 0x7a5e4a, [0, 0.45, -0.7]);
  k.add(cyl(0.05, 0.05, 3), 0x555555, [3.2, 1.5, 0.8]);
  k.add(box(1.2, 0.6, 0.08), 0x5f9e6e, [3.2, 2.8, 0.8]);
  return k;
}

export function poleKit(): Kit {
  return new Kit().add(cyl(0.12, 0.15, 7, 6), 0x5f5550, [0, 3.5, 0]).add(box(0.12, 0.12, 1.4), 0x5f5550, [0, 6.5, 0]);
}

/** Football pitch: subdivided so it bends cleanly over the pole. */
export function pitchKit(w: number, d: number): Kit {
  const k = new Kit();
  const flat = (pw: number, pd: number, color: number, x: number, z: number, y: number) =>
    k.add(new THREE.PlaneGeometry(pw, pd, Math.max(1, Math.ceil(pw / 2)), Math.max(1, Math.ceil(pd / 2))), color, [x, y, z], {
      rot: [-Math.PI / 2, 0, 0],
    });
  flat(w + 2, d + 2, 0x5e9b58, 0, 0, 0.02);
  for (let i = 0; i < 6; i++) flat(w / 6, d, i % 2 ? 0x6aa864 : 0x5c9a58, -w / 2 + w / 12 + (i * w) / 6, 0, 0.025);
  const line = 0xf4efe4;
  flat(w, 0.15, line, 0, -d / 2, 0.03);
  flat(w, 0.15, line, 0, d / 2, 0.03);
  flat(0.15, d, line, -w / 2, 0, 0.03);
  flat(0.15, d, line, w / 2, 0, 0.03);
  flat(0.15, d, line, 0, 0, 0.03);
  for (const s of [-1, 1]) {
    k.add(cyl(0.08, 0.08, 2.2, 6), 0xffffff, [s * (w / 2), 1.1, -1.8]);
    k.add(cyl(0.08, 0.08, 2.2, 6), 0xffffff, [s * (w / 2), 1.1, 1.8]);
    k.add(box(0.12, 0.12, 3.7), 0xffffff, [s * (w / 2), 2.2, 0]);
  }
  return k;
}

/** A market stall: a trestle table of produce under a coloured canopy. */
export function marketStallKit(rng: Rng): Kit {
  const k = new Kit();
  k.add(box(2.4, 0.85, 1.4), mix(0x9a7a5a, GRIME, rng.range(0, 0.3)), [0, 0.42, 0]);
  for (const [x, z] of [[-1.15, -0.65], [1.15, -0.65], [-1.15, 0.65], [1.15, 0.65]] as const) {
    k.add(cyl(0.05, 0.05, 2.3, 5), 0x5a5550, [x, 1.15, z]);
  }
  k.add(box(2.9, 0.1, 1.9), aged(rng, rng.pick(KIOSKS)), [0, 2.32, 0]);
  // Heaps of tomatoes, peppers, yams, greens and garri.
  for (let i = 0; i < 6; i++) {
    const color = rng.pick([0xc9402f, 0xe0a23a, 0x7a5a3a, 0x5f9e6e, 0xe8dcc0, 0xb8452f]);
    k.add(new THREE.IcosahedronGeometry(rng.range(0.16, 0.26), 0), color, [-0.9 + i * 0.36, 0.95, rng.range(-0.35, 0.35)]);
  }
  return k;
}
