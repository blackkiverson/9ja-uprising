import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LocationId, NpcId } from '@9ja/shared';
import { Collisions, Footprints } from './collision';
import { Kit, box } from './kit';
import {
  GATES,
  KIOSKS,
  WALL_PAINTS,
  aged,
  antenna,
  borehole,
  churchKit,
  cityKit,
  danfoKit,
  foodStallKit,
  houseKit,
  kekeKit,
  kioskKit,
  mosqueKit,
  pitchKit,
  poleKit,
  shelterKit,
  tankTower,
} from './kits';
import { RoadNetwork, facing, loopEdge, mainLoop, type RoadEdge } from './roads';
import { Rng } from './rng';
import { SIGN, SIGN_COUNT, Signs } from './signs';
import { Frame, POLE_Z, R, chartOf } from './sphere';
import { Terrain, archGeometry, bendGeometry, outcropKit } from './terrain';
import { toonMaterial, withOutline } from './toon';
import { Vegetation } from './vegetation';

export interface Place {
  id: LocationId;
  label: string;
  /** Where the player stands to interact (world space, on the surface). */
  door: THREE.Vector3;
}

export interface World {
  ground: THREE.Mesh;
  places: Place[];
  /** Buildings that fade when they block the view of the player. userData: { frame, bounds }. */
  occluders: THREE.Mesh[];
  collisions: Collisions;
  /** Lights that follow the player so the area around them is always lit the same way. */
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  /** Where each NPC stands (they face the player when near). */
  npcSpots: Record<NpcId, Frame>;
  /** The street web (also the future traffic graph). */
  roads: RoadNetwork;
  /** Per-frame animation (river flow). */
  update: (dt: number) => void;
  /** Ground height above the base sphere (hills). */
  heightAt: (p: THREE.Vector3) => number;
  /** Where smoke rises from: cooking pots, bush fires, smouldering rubbish. */
  smokeSpots: { p: THREE.Vector3; kind: 'cook' | 'fire' | 'refuse' }[];
}

const WORLD_SEED = 9_2026;
export const SKY = 0x76b6b1;

/*
 * Planet plan.
 * - A winding main road loops round the planet; a web of streets and lanes branches off it.
 * - Longitude splits the districts: city to the east (lambda > 0), suburb to the west,
 *   a leafy hub at lambda = 0 (home, food stall, bus stop, office) and bush on the far side.
 * - Small parks at each pole: a mesa with a grove up north, a football pitch down south.
 */
const HUB = 0.22; // half-width of the hub, radians of longitude
const FAR = 0.35; // half-width of the far-side bush
const BAND = 42; // streets fill |z| < BAND metres; beyond that are the polar parks
/** Sachets, nylon bags, bottles, paper. */
const LITTER = [0xf4f4ee, 0xe8ecef, 0x2f3a3a, 0x3b6fb0, 0xc9584d, 0x5f9e6e, 0xd9b44a];

const inCity = (l: number) => l > HUB && l < Math.PI - FAR;
const inSuburb = (l: number) => l < -HUB && l > -Math.PI + FAR;
const zoneOf = (p: THREE.Vector3): 'city' | 'suburb' | 'green' => {
  const { lambda, z } = chartOf(p);
  if (Math.abs(z) > BAND + 2) return 'green';
  return inCity(lambda) ? 'city' : inSuburb(lambda) ? 'suburb' : 'green';
};
const loopZ = (l: number) => 6.5 * Math.sin(2 * l + 0.4) + 3 * Math.sin(5 * l + 1.3) - 1;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const noise = (p: THREE.Vector3) =>
  (Math.sin(p.x * 0.13) + Math.sin(p.z * 0.17 + 1.3) + Math.sin((p.y + p.x) * 0.09 + 2.1)) / 3;
const surf = (lambda: number, z: number) => new Frame(lambda, -z / R).c.clone();

// --- River: meanders north-south through the far-side bush, between a pond near each pole. ---
const RIVER_HW = 2.6;
const RIVER_Z = 38;
const POND_R = 5.5;
const riverAt = (u: number) => ({
  lambda: Math.PI + 0.11 * Math.sin(u * Math.PI * 3) + 0.035 * Math.sin(u * Math.PI * 7 + 1),
  z: -RIVER_Z + 2 * RIVER_Z * u,
});
const RIVER_SAMPLES = Array.from({ length: 161 }, (_, i) => {
  const { lambda, z } = riverAt(i / 160);
  return surf(lambda, z);
});
const PONDS = [RIVER_SAMPLES[0]!, RIVER_SAMPLES[RIVER_SAMPLES.length - 1]!];
const riverDistance = (p: THREE.Vector3) => Math.min(...RIVER_SAMPLES.map((q) => q.distanceTo(p)));

function onRiver(p: THREE.Vector3, pad = 0.3): boolean {
  if (PONDS.some((q) => q.distanceTo(p) < POND_R + 1 + pad)) return true;
  return RIVER_SAMPLES.some((q) => q.distanceTo(p) < RIVER_HW + 1.2 + pad);
}

/** Toon water: flat teal with lighter flow streaks that scroll downstream. */
function flowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  // Murky, like most Lagos waterways: green-brown water, silty smudges, scum along the banks.
  g.fillStyle = '#6d8b78';
  g.fillRect(0, 0, 64, 256);
  const rng = new Rng(404);
  const wrapRect = (x: number, y: number, w: number, h: number) => {
    g.fillRect(x, y, w, h);
    if (y + h > 256) g.fillRect(x, y - 256, w, h);
  };
  for (let i = 0; i < 14; i++) {
    g.fillStyle = rng.chance(0.5) ? '#7d7a5c' : '#66806a';
    wrapRect(rng.range(6, 50), rng.range(0, 256), rng.range(6, 14), rng.range(18, 40));
  }
  for (let i = 0; i < 22; i++) {
    g.fillStyle = rng.chance(0.5) ? '#86a08c' : '#9bb09b';
    wrapRect(rng.range(8, 54), rng.range(0, 256), rng.range(2, 3.5), rng.range(12, 34));
  }
  for (let i = 0; i < 40; i++) {
    // Foam and scum collecting at the edges.
    g.fillStyle = rng.chance(0.6) ? '#c9cdb8' : '#b8bca4';
    const edge = rng.chance(0.5) ? rng.range(0, 7) : rng.range(57, 64);
    wrapRect(edge, rng.range(0, 256), rng.range(1.5, 4), rng.range(2, 6));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A band along a polyline: offset sideways (metres, + = right), subdivided across so it hugs the curve. */
function polyStrip(
  pts: THREE.Vector3[],
  offset: number,
  width: number,
  h: number,
  color: number,
  skip: (p: THREE.Vector3) => boolean = () => false,
  across = 4,
  withUv = false,
  vScale = 6,
): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const c = new THREE.Color(color);
  const rows: { p: THREE.Vector3[]; v: number; centre: THREE.Vector3 }[] = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[Math.min(i + 1, pts.length - 1)]!;
    const o = pts[Math.max(i - 1, 0)]!;
    if (i > 0) along += p.distanceTo(o);
    const up = p.clone().normalize();
    const side = new THREE.Vector3().subVectors(q, o).cross(up).normalize();
    const row: THREE.Vector3[] = [];
    for (let k = 0; k <= across; k++) {
      row.push(p.clone().addScaledVector(side, offset - width / 2 + (width * k) / across).setLength(R + h));
    }
    rows.push({ p: row, v: along / vScale, centre: p.clone().addScaledVector(side, offset) });
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    if (skip(a.centre) || skip(b.centre)) continue;
    for (let k = 0; k < across; k++) {
      let quad = [a.p[k]!, b.p[k]!, a.p[k + 1]!, b.p[k]!, b.p[k + 1]!, a.p[k + 1]!];
      const u0 = k / across;
      const u1 = (k + 1) / across;
      let uvs = [u0, a.v, u0, b.v, u1, a.v, u0, b.v, u1, b.v, u1, a.v];
      // Front faces must point away from the planet, or the toon lighting reads them as undersides.
      const n = new THREE.Vector3().subVectors(quad[1]!, quad[0]!).cross(new THREE.Vector3().subVectors(quad[2]!, quad[0]!));
      if (n.dot(quad[0]!) < 0) {
        quad = [quad[0]!, quad[2]!, quad[1]!, quad[3]!, quad[5]!, quad[4]!];
        uvs = [uvs[0]!, uvs[1]!, uvs[4]!, uvs[5]!, uvs[2]!, uvs[3]!, uvs[6]!, uvs[7]!, uvs[10]!, uvs[11]!, uvs[8]!, uvs[9]!];
      }
      quad.forEach((p, j) => {
        pos.push(p.x, p.y, p.z);
        const n = p.clone().normalize();
        nor.push(n.x, n.y, n.z);
        col.push(c.r, c.g, c.b);
        uv.push(uvs[j * 2]!, uvs[j * 2 + 1]!);
      });
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function outlinedMesh(geometry: THREE.BufferGeometry, thickness: number): THREE.Mesh {
  return withOutline(new THREE.Mesh(geometry, toonMaterial(0xffffff, { vertexColors: true })), thickness);
}

/** A frame offset (x east, z south) inside a parent frame, keeping its yaw. */
function subFrame(parent: Frame, x: number, z: number): Frame {
  const f = Frame.fromPoint(parent.toWorld(x, 0, z));
  return new Frame(f.lambda, f.phi, Math.atan2(-parent.e.dot(f.s), parent.e.dot(f.e)));
}

export function buildWorld(scene: THREE.Scene): World {
  const rng = new Rng(WORLD_SEED);
  const collisions = new Collisions();
  const terrain = new Terrain();
  const veg = new Vegetation(rng, collisions, (p) => terrain.heightAt(p));
  const signs = new Signs();
  const footprints = new Footprints();
  const occluders: THREE.Mesh[] = [];
  const places: Place[] = [];
  const staticParts: THREE.BufferGeometry[] = []; // walls and props, merged into one draw call
  const gates: THREE.Vector3[] = []; // every doorway, so poles and props keep clear of them
  const smokeSpots: World['smokeSpots'] = [];

  // --- Sky and lights. Lights follow the player (see main.ts) so there is no dark side underfoot. ---
  scene.background = new THREE.Color(SKY);
  const hemi = new THREE.HemisphereLight(0xf3f1e4, 0x5f8f8a, 1.3);
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.4);
  scene.add(hemi, sun, sun.target);

  // --- Ground: flat painted patches of grass and earth, dusty in the city. ---
  const groundGeo = new THREE.SphereGeometry(R, 192, 128);
  const pos = groundGeo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const PATCHES = [0x52894f, 0x5e9b58, 0x6faa62].map((h) => new THREE.Color(h));
  const earth = new THREE.Color(0xc9b98e);
  const dust = new THREE.Color(0xc2c0ab);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const { lambda, z } = chartOf(v);
    const n = noise(v);
    const n2 = noise(v.clone().multiplyScalar(1.9).addScalar(17));
    c.copy(PATCHES[n < -0.2 ? 0 : n < 0.25 ? 1 : 2]!);
    if (n2 > 0.55) c.copy(earth);
    const city =
      smoothstep(HUB - 0.08, HUB + 0.12, lambda + n * 0.05) *
      (1 - smoothstep(Math.PI - FAR - 0.12, Math.PI - FAR + 0.08, lambda)) *
      (1 - smoothstep(BAND, BAND + 5, Math.abs(z)));
    if (city > 0.5) c.copy(n2 > 0.35 ? earth : dust);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(groundGeo, toonMaterial(0xffffff, { vertexColors: true }));
  ground.name = 'ground';
  scene.add(ground);

  // --- Streets. The hub and its places are reserved first so streets route round them. ---
  const loop = mainLoop(loopZ);
  const mainEdge = loopEdge(loop);
  const HUB_S = mainEdge.arc[loop.length / 2]!; // loop point at longitude 0
  const roadsideOf = (e: RoadEdge, s: number, sideSign: 1 | -1, dist: number) => {
    const t = THREE.MathUtils.clamp(s, 0, mainEdge.arc[mainEdge.arc.length - 1]!);
    let i = 0;
    while (i < e.arc.length - 2 && e.arc[i + 1]! < t) i++;
    const p = e.pts[i]!.clone().lerp(e.pts[i + 1]!, (t - e.arc[i]!) / (e.arc[i + 1]! - e.arc[i]! || 1)).setLength(R);
    const tan = new THREE.Vector3().subVectors(e.pts[i + 1]!, e.pts[i]!).normalize();
    const side = tan.clone().cross(p.clone().normalize()).normalize();
    return { p, tan, side, frame: facing(p.clone().addScaledVector(side, sideSign * dist).setLength(R), side.clone().multiplyScalar(-sideSign)) };
  };
  const hubPoint = roadsideOf(mainEdge, HUB_S, 1, 0).p;
  // Reserved sites along the main road at the hub (north = -1, south = +1).
  const MAIN_HW = 3;
  const FRONT = MAIN_HW + 0.6; // carriageway + gutter
  const reserved = [
    { s: HUB_S, side: -1 as const, dist: FRONT + 2.3, r: 9 }, // food stall + kiosks
    { s: HUB_S - 6, side: 1 as const, dist: FRONT + 2, r: 8 }, // bus stop
    { s: HUB_S + 16, side: 1 as const, dist: FRONT + 5, r: 8 }, // office
    { s: HUB_S - 22, side: -1 as const, dist: FRONT + 10.5, r: 11 }, // home compound (set back so the gate has a verge)
    { s: HUB_S + 22, side: -1 as const, dist: FRONT + 9.5, r: 11 }, // church
    { s: HUB_S - 34, side: 1 as const, dist: FRONT + 7, r: 9 }, // mosque
  ].map((r) => ({ ...r, c: roadsideOf(mainEdge, r.s, r.side, r.dist).frame.c }));
  const nearReserved = (p: THREE.Vector3, pad: number) => reserved.some((r) => r.c.distanceTo(p) < r.r + pad);

  const roads = new RoadNetwork(rng, {
    loop,
    band: BAND,
    spacing: (p) => ({ city: 22, suburb: 28, green: 34 })[zoneOf(p)],
    maxDegree: 3,
    maxStreets: 14,
    blocked: (p) => hubPoint.distanceTo(p) < 22 || nearReserved(p, 4) || onRiver(p, 5) || Math.abs(chartOf(p).z) > BAND,
    edgeBlocked: (p) => hubPoint.distanceTo(p) < 14 || nearReserved(p, 1) || PONDS.some((q) => q.distanceTo(p) < POND_R + 4),
    zone: zoneOf,
  });
  const nodeR = roads.nodes.map((_, i) => roads.junctionRadius(i));
  const nearJunction = (p: THREE.Vector3, extra: number) => roads.nodes.some((q, i) => !roads.isolated.has(i) && q.distanceTo(p) < nodeR[i]! + extra);
  const free = (p: THREE.Vector3, pad = 0.3) => !roads.near(p, pad) && !onRiver(p, pad) && !footprints.contains(p, pad);
  /** For things that belong right beside a street (heaps, kiosks): off the road, but allowed close to it. */
  // `onShoulder` lets the centre sit on the pavement/verge strip, just clear of the carriageway.
  const roadsideFree = (p: THREE.Vector3, pad: number, onShoulder = 0) => !roads.near(p, 0.05 - onShoulder) && !onRiver(p, pad) && !footprints.contains(p, pad);

  // Road surfaces, gutters, pavements, lane dashes and junction plates: one draw call.
  {
    const parts: THREE.BufferGeometry[] = [];
    const push = (g: THREE.BufferGeometry | null) => g && parts.push(g);
    const H = { lane: 0.01, street: 0.013, main: 0.016 };
    for (const e of roads.edges) {
      const asphalt = e.surface === 'asphalt';
      push(polyStrip(e.pts, 0, e.width, H[e.kind], asphalt ? 0x6a6e6c : 0xb88a6a, () => false, e.width > 5 ? 6 : 4));
      const gutters = e.kind === 'main' || (e.city && e.kind === 'street');
      const trim = (p: THREE.Vector3) => nearJunction(p, 0.4);
      for (const sgn of [-1, 1]) {
        if (gutters) push(polyStrip(e.pts, sgn * (e.width / 2 + 0.3), 0.6, 0.017, 0x445049, trim, 1));
        if (e.city) push(polyStrip(e.pts, sgn * (e.width / 2 + (gutters ? 0.6 : 0.2) + 0.75), 1.5, 0.012, 0xd0d2c6, trim, 2));
      }
      if (e.kind === 'main') {
        const len = roads.length(e);
        for (let s = 2; s < len - 2; s += 5) {
          const { p, t } = roads.at(e, s);
          // Paint wears off: some dashes are gone, some are faded and short.
          if (nearJunction(p, 1.5) || rng.chance(0.3)) continue;
          const faded = rng.chance(0.35);
          const dash = new Kit().add(new THREE.PlaneGeometry(0.16, faded ? rng.range(0.8, 1.6) : 2.2), faded ? 0xb3b6ae : 0xeef0e6, [0, 0.022, 0], { rot: [-Math.PI / 2, 0, 0] });
          parts.push(dash.bend(facing(p, t)).geometry);
        }
      }
    }
    // --- Road wear: patches, cracks, crumbling edges, potholes; ruts and puddles on laterite. ---
    const blob = (r: number, jag = 0.3) => {
      const g = new THREE.CircleGeometry(1, 10);
      const a = g.attributes.position!;
      for (let i = 1; i < a.count; i++) {
        const k = 1 + rng.range(-jag, jag);
        a.setXY(i, a.getX(i) * k, a.getY(i) * k);
      }
      return g.scale(r, r, 1);
    };
    const decal = (e: RoadEdge, s: number, offset: number, h: number, geo: THREE.BufferGeometry, color: number, yaw = rng.range(0, Math.PI)) => {
      const { p, t, side } = roads.at(e, s);
      if (nearJunction(p, 0.5)) return;
      const c0 = p.clone().addScaledVector(side, offset).setLength(R);
      const k = new Kit().add(geo, color, [0, h, 0], { rot: [-Math.PI / 2, 0, yaw] });
      parts.push(k.bend(facing(c0, t)).geometry);
    };
    for (const e of roads.edges) {
      const len = roads.length(e);
      const base = { lane: 0.01, street: 0.013, main: 0.016 }[e.kind] + 0.008;
      const hw = e.width / 2;
      if (e.surface === 'asphalt') {
        for (let s = 1; s < len - 1; s += rng.range(2.5, 5)) {
          const roll = rng.next();
          const off = rng.range(-hw + 0.5, hw - 0.5);
          if (roll < 0.22) {
            // Patched repair: a darker or lighter square-ish patch.
            const pw = rng.range(0.8, 1.8);
            decal(e, s, off, base, new THREE.PlaneGeometry(pw, rng.range(0.6, 1.4)), rng.pick([0x5d6260, 0x787b77, 0x646866]));
          } else if (roll < 0.42) {
            // Crack: a couple of thin dark lines.
            for (let i = 0; i < rng.int(1, 3); i++) decal(e, s + rng.range(-0.4, 0.4), off + rng.range(-0.3, 0.3), base + 0.001, new THREE.PlaneGeometry(0.05, rng.range(0.8, 2)), 0x3f4442);
          } else if (roll < 0.6) {
            // Pothole: broken lighter rim, dark hole, sometimes muddy water.
            const r0 = rng.range(0.3, 0.75);
            decal(e, s, off, base, blob(r0 * 1.25, 0.25), 0x8a8d88);
            decal(e, s, off, base + 0.002, blob(r0, 0.35), 0x343837);
            if (rng.chance(0.4)) decal(e, s, off, base + 0.004, blob(r0 * 0.7, 0.3), 0x6f8a80);
          } else if (roll < 0.72 && e.kind !== 'main') {
            // Crumbling edge: the laterite underneath shows through.
            const sgn = rng.chance(0.5) ? -1 : 1;
            decal(e, s, sgn * (hw - 0.25), base, blob(rng.range(0.4, 0.9), 0.4), 0xb88a6a);
          }
        }
      } else {
        for (let s = 1; s < len - 1; s += rng.range(2, 4)) {
          const roll = rng.next();
          if (roll < 0.35) {
            // Ruts: twin darker tracks.
            for (const o2 of [-0.6, 0.6]) decal(e, s, o2, base, new THREE.PlaneGeometry(0.28, rng.range(1.5, 3)), 0x9c7458, 0);
          } else if (roll < 0.55) {
            // Puddle in a dip.
            const r0 = rng.range(0.4, 0.9);
            decal(e, s, rng.range(-hw + 0.5, hw - 0.5), base, blob(r0 * 1.2, 0.3), 0x8f6a50);
            decal(e, s, rng.range(-0.1, 0.1) + 0, base + 0.002, blob(r0, 0.3), 0x6f8a80);
          }
        }
      }
    }

    // --- Dirt and litter: sand washed over the edges, sachets and nylon bags, the odd rubbish heap. ---
    for (const e of roads.edges) {
      const len = roads.length(e);
      const base = { lane: 0.01, street: 0.013, main: 0.016 }[e.kind] + 0.012;
      const hw = e.width / 2;
      for (let s = 1; s < len - 1; s += rng.range(3, 6)) {
        const sgn = rng.chance(0.5) ? -1 : 1;
        // Sand and dirt drifting in from the verge.
        if (rng.chance(0.4)) decal(e, s, sgn * (hw - rng.range(0.1, 0.5)), base, blob(rng.range(0.5, 1.1), 0.45), rng.pick([0xc9b98e, 0xbfae84, 0xb8a27a]));
        // Scattered litter along the gutter line and road edge.
        for (let i = 0; i < rng.int(1, 4); i++) {
          const piece = rng.chance(0.5) ? new THREE.PlaneGeometry(rng.range(0.12, 0.28), rng.range(0.08, 0.2)) : blob(rng.range(0.08, 0.16), 0.5);
          decal(e, s + rng.range(-1, 1), sgn * (hw + rng.range(-0.6, 0.5)), base + 0.002, piece, rng.pick(LITTER));
        }
      }
    }

    roads.nodes.forEach((p, i) => {
      if (roads.isolated.has(i)) return;
      const asphalt = roads.edges.some((e) => (e.a === i || e.b === i) && e.surface === 'asphalt');
      // Sits above the strips it covers; finely subdivided so it doesn't sag into them.
      const plate = new Kit().add(new THREE.RingGeometry(0, nodeR[i]!, 28, 8), asphalt ? 0x6a6e6c : 0xb88a6a, [0, 0.03, 0], { rot: [-Math.PI / 2, 0, 0] });
      parts.push(plate.bend(Frame.fromPoint(p)).geometry);
    });
    const mesh = new THREE.Mesh(mergeGeometries(parts, false)!, toonMaterial(0xffffff, { vertexColors: true }));
    mesh.raycast = () => {};
    scene.add(mesh);
  }

  /** Places a kit bent onto the planet as a fading building (one mesh, one outline). */
  const building = (kit: Kit, f: Frame, w: number, d: number) => {
    const { geometry, bounds } = kit.bend(f);
    const mesh = outlinedMesh(geometry, 0.05);
    mesh.userData = { frame: f, bounds };
    scene.add(mesh);
    occluders.push(mesh);
    collisions.rect(f, w, d);
    footprints.add(f, w, d);
    return mesh;
  };
  /** Places a static prop kit (merged with walls and other props). */
  const prop = (kit: Kit, f: Frame) => staticParts.push(kit.bend(f).geometry);

  // --- Suburb compound: walls, gate facing the street (+z), bungalow, yard. ---
  const compound = (f: Frame, w: number, d: number, isHome: boolean) => {
    const hw = w / 2;
    const hd = d / 2;
    const GAP = 3.2;
    const k = new Kit();
    const wallColor = aged(rng, rng.pick(WALL_PAINTS));
    const gateColor = rng.pick(GATES);
    const wall = (cx: number, cz: number, ww: number, dd: number) => {
      const pieces = Math.max(1, Math.ceil(Math.max(ww, dd) / 4));
      for (let i = 0; i < pieces; i++) {
        const t = (i + 0.5) / pieces - 0.5;
        const px = ww > dd ? cx + t * ww : cx;
        const pz = ww > dd ? cz : cz + t * dd;
        const [pw, pd] = ww > dd ? [ww / pieces, dd] : [ww, dd / pieces];
        // Walls get patched piece by piece: some bare block, some a different shade; all damp at the base.
        const roll = rng.next();
        const pieceColor = roll < 0.15 ? 0xb5b2a4 : roll < 0.3 ? aged(rng, rng.pick(WALL_PAINTS)) : wallColor;
        k.add(box(pw, 2.4, pd), pieceColor, [px, 0.6, pz]);
        k.add(box(pw + 0.03, 0.45, pd + 0.03), 0x8a8574, [px, 0.22, pz]);
        footprints.add(subFrame(f, px, pz), pw, pd);
      }
      // One solid collider per wall side (a row of pieces leaves seams that snag the player).
      collisions.rect(subFrame(f, cx, cz), ww + 0.05, dd + 0.05);
    };
    wall(0, -hd, w, 0.3);
    wall(-hw, 0, 0.3, d);
    wall(hw, 0, 0.3, d);
    const side = (w - GAP) / 2;
    wall(-hw + side / 2, hd, side, 0.3);
    wall(hw - side / 2, hd, side, 0.3);
    for (const s of [-1, 1]) {
      k.add(box(0.5, 2.1, 0.5), 0xc4c6b8, [(s * GAP) / 2, 1.05, hd]);
      k.add(box(0.1, 1.7, GAP / 2 - 0.1), gateColor, [s * (GAP / 2 - 0.15), 0.95, hd - GAP / 4]);
    }
    prop(k, f);

    const bw = Math.min(rng.range(8, 10.5), w - 5);
    const bd = Math.min(rng.range(6, 7.5), d - 6);
    building(houseKit(rng, bw, bd), subFrame(f, 0, -1.2), bw + 0.3, bd + 0.3);
    const footprint = { contains: (p: THREE.Vector3) => footprints.contains(p, 1.6) };

    const corners = [
      [-hw + 2.3, -hd + 2.3],
      [hw - 2.3, -hd + 2.3],
      [-hw + 2.3, hd - 2.3],
      [hw - 2.3, hd - 2.3],
    ].sort(() => rng.next() - 0.5);
    let trees = rng.int(1, 3);
    const used = new Set<number>();
    corners.forEach(([lx, lz], idx) => {
      if (trees <= 0) return;
      const p = f.toWorld(lx!, 0, lz!);
      if (footprint.contains(p) || (Math.abs(lx!) < 3 && lz! > 0)) return;
      veg.tree(p, rng.range(0.85, 1.1));
      used.add(idx);
      trees--;
    });
    const extras = corners.filter(([lx, lz], idx) => !used.has(idx) && !footprints.contains(f.toWorld(lx!, 0, lz!), 1.4) && !(Math.abs(lx!) < 3 && lz! > 0));
    if (extras[0] && rng.chance(0.4)) {
      const sf = subFrame(f, extras[0][0]!, extras[0][1]!);
      prop(tankTower(rng.pick([0x2b5aa8, 0x2a2a2a])), sf);
      collisions.rect(sf, 1.5, 1.5);
      footprints.add(sf, 1.8, 1.8);
    }
    if (extras[1] && rng.chance(0.3)) {
      const sf = subFrame(f, extras[1][0]!, extras[1][1]!);
      prop(borehole(), sf);
      collisions.rect(sf, 1, 1);
      footprints.add(sf, 1.4, 1.4);
    } else if (extras[1] && rng.chance(0.2)) {
      const sf = subFrame(f, extras[1][0]!, extras[1][1]!);
      const mast = new Kit();
      antenna(mast, 0, 0, 0, rng.range(6, 9));
      prop(mast, sf);
      collisions.circle(sf.c, 0.25);
    }
    if (rng.chance(0.25)) {
      const s = rng.chance(0.5) ? -1 : 1;
      signs.painted(subFrame(f, s * (GAP / 2 + (w - GAP) / 4), hd + 0.17).matrix(0, 1.05, 0), SIGN.notForSale, 2.2);
    }
    for (let i = 0; i < 6; i++) {
      const t = rng.range(-0.8, 0.8);
      const [lx, lz] = rng.pick([
        [t * hw, -hd + 0.9],
        [-hw + 0.9, t * hd],
        [hw - 0.9, t * hd],
      ] as const);
      const p = f.toWorld(lx, 0, lz);
      if (!footprints.contains(p, 0.6)) veg.bush(p, rng.range(0.7, 1));
    }
    for (let i = 0; i < 12; i++) {
      const p = f.toWorld(rng.range(-hw + 0.6, hw - 0.6), 0, rng.range(-hd + 0.6, hd - 0.6));
      if (!footprints.contains(p, 0.2)) veg.tuft(p);
    }
    const door = f.toWorld(0, 0, hd + 1.6);
    gates.push(door);
    footprints.add(subFrame(f, 0, hd + 1.8), GAP + 1, 3.2);
    // The whole yard is taken, so nothing later gets built across the walls or inside them.
    footprints.add(f, w + 0.4, d + 0.4);
    if (isHome) places.push({ id: 'home', label: 'Home (family compound)', door });
  };

  // --- Hub: the places, along the main road at longitude 0. ---
  const site = (i: number) => roadsideOf(mainEdge, reserved[i]!.s, reserved[i]!.side, reserved[i]!.dist);
  {
    const stall = site(0).frame;
    prop(foodStallKit(), stall);
    collisions.rect(stall, 4.4, 2.6);
    footprints.add(stall, 10, 5);
    places.push({ id: 'food_stall', label: "Mama Put's food stall", door: stall.toWorld(0, 0, 3.6) });
    // Steam and smoke off Mama Nkechi's pots.
    smokeSpots.push({ p: stall.toWorld(-1, 1.5, 1.4), kind: 'cook' }, { p: stall.toWorld(0.6, 1.45, 1.4), kind: 'cook' });
    for (const ds of [-8, 8]) {
      const f = roadsideOf(mainEdge, HUB_S + ds, -1, MAIN_HW + 0.95).frame;
      prop(kioskKit(rng.pick(KIOSKS)), f);
      collisions.rect(f, 2.2, 1.6);
      footprints.add(f, 2.8, 2.2);
    }

    const shelter = site(1).frame;
    prop(shelterKit(), shelter);
    collisions.rect(subFrame(shelter, 0, -0.7), 4, 0.6);
    footprints.add(shelter, 7, 3);
    places.push({ id: 'bus_stop', label: 'Bus stop (danfo park)', door: shelter.toWorld(0, 0, 1.9) });
    // Parked off the carriageway on the verge, like a motor park, so traffic can pass.
    for (const ds of [-12, -18]) {
      const r = roadsideOf(mainEdge, HUB_S + ds, 1, FRONT + 1.3);
      const f = facing(r.frame.c, r.tan);
      prop(danfoKit(), f);
      collisions.rect(f, 2.1, 4.8);
    }
    for (const ds of [1.5, 4]) {
      const r = roadsideOf(mainEdge, HUB_S + ds, 1, FRONT + 1.2);
      const f = facing(r.frame.c, r.tan.clone().applyAxisAngle(r.frame.n, rng.range(-0.3, 0.3)));
      prop(kekeKit(), f);
      collisions.rect(f, 1.3, 2.1);
      footprints.add(f, 1.8, 2.6);
    }
  }
  const office = site(2).frame;
  building(cityKit(rng, 10, 8, 4, 0xa9cfd6), office, 10, 8);
  places.push({ id: 'office', label: 'Office (Bode Thomas St)', door: office.toWorld(0, 0, 4.8) });
  compound(site(3).frame, 16, 15, true);
  {
    // Church and mosque face the main road. Fictional congregations.
    const church = site(4).frame;
    const cm = churchKit().bend(church);
    const mesh = outlinedMesh(cm.geometry, 0.05);
    mesh.userData = { frame: church, bounds: cm.bounds };
    scene.add(mesh);
    occluders.push(mesh);
    collisions.rect(subFrame(church, 0, 1.35), 9.6, 16.2);
    footprints.add(subFrame(church, 0, 1.35), 11, 18);
    const mosque = site(5).frame;
    const mm = mosqueKit().bend(mosque);
    const m2 = outlinedMesh(mm.geometry, 0.05);
    m2.userData = { frame: mosque, bounds: mm.bounds };
    scene.add(m2);
    occluders.push(m2);
    collisions.rect(mosque, 10.6, 10.6);
    footprints.add(mosque, 12, 12);
  }

  // NPC spots near the places they belong to.
  const homeDoor = places.find((p) => p.id === 'home')!.door;
  const npcSpots: Record<NpcId, Frame> = {
    mama_nkechi: roadsideOf(mainEdge, HUB_S + 2.2, -1, FRONT + 1).frame,
    kelz: roadsideOf(mainEdge, HUB_S - 10.6, -1, FRONT + 1).frame,
    tunde: roadsideOf(mainEdge, HUB_S - 15, 1, FRONT + 2.9).frame,
    oga_bayo: roadsideOf(mainEdge, HUB_S + 19.5, 1, FRONT + 0.8).frame,
    mallam_sani: Frame.fromPoint(Frame.fromPoint(homeDoor).toWorld(-3.4, 0, 0)),
  };
  for (const f of Object.values(npcSpots)) {
    footprints.add(f, 2.4, 2.4);
    collisions.circle(f.c, 0.35);
    gates.push(f.c.clone());
  }

  // --- Buildings along every street, facing it. City: dense blocks; suburb: compounds. ---
  const bushPlots: { f: Frame; w: number; d: number }[] = [];
  const reject: Record<string, number> = {};
  const order = [...roads.edges].sort((a, b) => ({ main: 0, street: 1, lane: 2 })[a.kind] - ({ main: 0, street: 1, lane: 2 })[b.kind]);
  for (const e of order) {
    const len = roads.length(e);
    const trimA = nodeR[e.a]! + 2;
    const trimB = nodeR[e.b]! + 2;
    for (const sideSign of [-1, 1] as const) {
      let s = trimA + rng.range(0, 2);
      while (s < len - trimB) {
        const zone = zoneOf(roads.at(e, s).p);
        if (zone === 'green') {
          s += 3;
          continue;
        }
        const city = zone === 'city';
        const [w, d] = city ? [rng.range(5.5, 9), rng.range(5.5, 7.5)] : [rng.range(13, 16), rng.range(12, 14)];
        if (s + w > len - trimB) break;
        const dist = e.width / 2 + e.shoulder + (city ? 0.3 : 1.6) + d / 2;
        const f = roads.roadside(e, s + w / 2, sideSign, dist);
        // Front edge sits just past the pavement (and streets curve), so it only fails if it is
        // well into the carriageway; the rest of the plot must be clear of every street.
        const front = [[-w / 2, d / 2], [w / 2, d / 2], [0, d / 2]].map(([x, z]) => f.toWorld(x!, 0, z!));
        const rest = [[-w / 2, -d / 2], [w / 2, -d / 2], [0, 0], [0, -d / 2], [-w / 2, 0], [w / 2, 0]].map(([x, z]) => f.toWorld(x!, 0, z!));
        const probe = [...front, ...rest];
        const why =
          front.some((q) => roads.near(q, -1.4)) || rest.some((q) => roads.near(q, -0.3)) ? 'road'
          : footprints.overlaps(f, w, d, 0.3) ? 'taken'
          : probe.some((q) => onRiver(q, 0.5)) ? 'river' : '';
        if (why) {
          reject[why] = (reject[why] ?? 0) + 1;
          s += 1.5;
          continue;
        }
        if (city) {
          // Like real Lagos, some plots are never built on and go wild with bush.
          if (rng.chance(0.2)) {
            bushPlots.push({ f, w, d });
            footprints.add(f, w, d);
          } else building(cityKit(rng, w, d, rng.int(1, 4)), f, w, d);
          s += w + rng.range(0.3, 1.2);
        } else {
          compound(f, w, d, false);
          s += w + rng.range(1, 2.5);
        }
      }
    }
  }
  // Infill: pack the inside of big blocks too, each building turned to its nearest street,
  // reached by footpaths, the way Lagos blocks fill up over time.
  for (let i = 0; i < 2500; i++) {
    const p = new Frame(rng.range(-Math.PI, Math.PI), rng.range(-BAND, BAND) / R).c.clone();
    const zone = zoneOf(p);
    if (zone === 'green' || !free(p, 2.5)) continue;
    const city = zone === 'city';
    const [w, d] = city ? [rng.range(5, 8), rng.range(5, 7)] : [rng.range(7, 10), rng.range(6, 7.5)];
    const near = roads.nearest(p);
    if (near.dist > 30) continue;
    const f = facing(p, near.toward);
    const probe = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0], [0, d / 2], [0, -d / 2]].map(([x, z]) => f.toWorld(x!, 0, z!));
    if (footprints.overlaps(f, w, d, 0.6) || !probe.every((q) => !roads.near(q, 0.5) && !onRiver(q, 0.5))) continue;
    if (city) building(cityKit(rng, w, d, rng.int(1, 3)), f, w, d);
    else building(houseKit(rng, w, d, rng.pick(['hip', 'gable', 'faceme'] as const)), f, w + 0.3, d + 0.3);
    footprints.add(f, w + 1.4, d + 1.4); // keep a footpath's width around each infill building
  }
  if (import.meta.env.DEV) console.info('[9ja] plot rejections', JSON.stringify(reject));
  for (const { f, w, d } of bushPlots) {
    for (let i = 0; i < rng.int(2, 4); i++) {
      const p = f.toWorld(rng.range(-w / 2 + 1.2, w / 2 - 1.2), 0, rng.range(-d / 2 + 1.2, d / 2 - 1.2));
      veg.tree(p, rng.range(0.9, 1.2));
    }
    for (let i = 0; i < 8; i++) veg.bush(f.toWorld(rng.range(-w / 2, w / 2), 0, rng.range(-d / 2, d / 2)), rng.range(0.8, 1.3));
    for (let i = 0; i < 26; i++) veg.tuft(f.toWorld(rng.range(-w / 2, w / 2), 0, rng.range(-d / 2, d / 2)));
  }
  // Repaint the ground under bush plots as grass rather than city dust.
  {
    const grass = [new THREE.Color(0x52894f), new THREE.Color(0x5e9b58)];
    const l = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      for (const { f, w, d } of bushPlots) {
        if (f.c.distanceToSquared(v) > (w + d) ** 2) continue;
        f.toLocal(v, l);
        if (Math.abs(l.x) < w / 2 + 0.8 && Math.abs(l.z) < d / 2 + 0.8) {
          const gc = grass[noise(v) > 0 ? 1 : 0]!;
          colors.set([gc.r, gc.g, gc.b], i * 3);
        }
      }
    }
    groundGeo.attributes.color!.needsUpdate = true;
  }

  // --- River, ponds, and a bridge wherever a street crosses. ---
  const water = flowTexture();
  {
    const onAnyRoad = (p: THREE.Vector3) => roads.near(p, 0.2);
    const bankMat = toonMaterial(0x6f6a4e);
    bankMat.side = THREE.DoubleSide;
    const bankGeo = polyStrip(RIVER_SAMPLES, 0, (RIVER_HW + 1) * 2, 0.004, 0x6f6a4e, onAnyRoad, 8);
    const riverGeo = polyStrip(RIVER_SAMPLES, 0, RIVER_HW * 2, 0.008, 0xffffff, onAnyRoad, 8, true);
    if (bankGeo) scene.add(Object.assign(new THREE.Mesh(bankGeo, bankMat), { raycast: () => {} }));
    if (riverGeo) {
      riverGeo.deleteAttribute('color');
      scene.add(Object.assign(new THREE.Mesh(riverGeo, new THREE.MeshBasicMaterial({ map: water, side: THREE.DoubleSide })), { raycast: () => {} }));
    }
    const pondMat = new THREE.MeshBasicMaterial({ color: 0x6d8b78 });
    for (const cc of PONDS) {
      const f = Frame.fromPoint(cc);
      staticParts.push(new Kit().add(new THREE.RingGeometry(0, POND_R + 1, 28, 6), 0x6f6a4e, [0, 0.004, 0], { rot: [-Math.PI / 2, 0, 0] }).bend(f).geometry);
      const pm = new THREE.Mesh(new Kit().add(new THREE.RingGeometry(0, POND_R, 28, 6), 0x6d8b78, [0, 0.008, 0], { rot: [-Math.PI / 2, 0, 0] }).bend(f).geometry, pondMat);
      pm.raycast = () => {};
      scene.add(pm);
      collisions.circle(cc, POND_R - 0.4);
      for (let i = 0; i < 10; i++) {
        const a = rng.range(0, Math.PI * 2);
        veg.tuft(f.toWorld(Math.cos(a) * (POND_R + 0.6), 0, Math.sin(a) * (POND_R + 0.6)));
      }
    }
    RIVER_SAMPLES.forEach((p, i) => {
      if (i % 2 === 0 && !roads.near(p, 0.6)) collisions.circle(p, RIVER_HW - 0.3);
    });
    // Bridges: railings along both edges where a street runs over the water.
    for (const e of roads.edges) {
      let run: number[] = [];
      const flush = () => {
        if (run.length < 2) return (run = []);
        const s0 = e.arc[run[0]!]!;
        const s1 = e.arc[run[run.length - 1]!]!;
        const span = s1 - s0 + 3;
        const { p, side } = roads.at(e, (s0 + s1) / 2);
        const bf = facing(p, side);
        const rails = new Kit();
        for (const z of [-(e.width / 2 + 0.3), e.width / 2 + 0.3]) {
          rails.add(box(span, 0.14, 0.16), 0xc4c6b8, [0, 0.95, z]);
          rails.add(box(span, 0.1, 0.12), 0xc4c6b8, [0, 0.5, z]);
          for (let x = -span / 2; x <= span / 2 + 0.01; x += 1.4) rails.add(box(0.16, 1.05, 0.16), 0xb4b6a8, [x, 0.52, z]);
          collisions.rect(subFrame(bf, 0, z), span, 0.3);
        }
        prop(rails, bf);
        run = [];
      };
      e.pts.forEach((p, i) => (riverDistance(p) < RIVER_HW + 0.6 ? run.push(i) : flush()));
      flush();
    }
  }

  // --- Terrain: a mesa at the north pole, soft hills in the far-side bush. ---
  terrain.add(new Frame(0, Math.PI / 2), 13, 6, true, rng);
  const hillClear = (cc: THREE.Vector3, r: number) => {
    const f = Frame.fromPoint(cc);
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const q = i === 16 ? cc : f.toWorld(Math.cos(a) * r * 1.25, 0, Math.sin(a) * r * 1.25);
      if (roads.near(q, 0.5) || onRiver(q, 0.8) || footprints.contains(q, 0.5)) return false;
    }
    return true;
  };
  for (let i = 0, made = 0; i < 120 && made < 5; i++) {
    const r = rng.range(5, 7.5);
    const cc = surf(Math.PI + rng.range(-0.32, 0.32), (rng.chance(0.5) ? -1 : 1) * rng.range(6, 44));
    if (!hillClear(cc, r)) continue;
    terrain.add(Frame.fromPoint(cc), r, rng.range(2.5, 4.5), rng.chance(0.3), rng);
    made++;
  }
  {
    const rockA = new THREE.Color(0xcbbd94);
    const rockB = new THREE.Color(0xbfb088);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const h = terrain.heightAt(v);
      if (h < 0.002) continue;
      if (terrain.slopeAt(v) > 0.8) {
        const rc = noise(v.clone().multiplyScalar(2.3)) > 0 ? rockA : rockB;
        colors.set([rc.r, rc.g, rc.b], i * 3);
      }
      v.setLength(R + h);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    groundGeo.computeVertexNormals();
    groundGeo.attributes.color!.needsUpdate = true;
  }
  const wild = () => {
    const roll = rng.next();
    if (roll < 0.45) return surf(Math.PI + rng.range(-0.32, 0.32), rng.range(-44, 44));
    if (roll < 0.7) return surf(rng.range(-HUB, HUB), (rng.chance(0.5) ? -1 : 1) * rng.range(12, 44));
    return new Frame(rng.range(-Math.PI, Math.PI), (rng.chance(0.5) ? 1 : -1) * rng.range(1.12, 1.45)).c.clone();
  };
  for (let i = 0, made = 0; i < 140 && made < 12; i++) {
    const p = wild();
    const { kit, radius } = outcropKit(rng, rng.range(1.2, 2.4));
    if (!free(p, radius + 0.5) || terrain.slopeAt(p) > 0.5) continue;
    const f = Frame.fromPoint(p, rng.range(0, Math.PI * 2));
    staticParts.push(bendGeometry(kit.build(), f, terrain.heightAt(p)));
    collisions.circle(p, radius * 0.75);
    footprints.add(f, radius * 2, radius * 2);
    made++;
  }
  for (let i = 0, made = 0; i < 140 && made < 2; i++) {
    const p = wild();
    const f = Frame.fromPoint(p, rng.range(0, Math.PI * 2));
    const span = rng.range(7, 10);
    const legs = [f.toWorld(-span / 2, 0, 0), f.toWorld(span / 2, 0, 0)];
    if (![p, ...legs].every((q) => free(q, 1.6)) || terrain.heightAt(p) > 0.5) continue;
    staticParts.push(bendGeometry(archGeometry(rng, span, rng.range(0.9, 1.3)), f));
    for (const q of legs) collisions.circle(q, 1.4);
    footprints.add(f, span + 3, 3.5);
    made++;
  }
  for (let i = 0; i < 60; i++) {
    const s = rng.range(0.15, 0.55);
    const stone = new Kit().add(new THREE.DodecahedronGeometry(1, 0), rng.pick([0xcbbd94, 0xbfb088, 0xa9a28c]), [0, s * 0.3, 0], {
      rot: [rng.range(0, 3), rng.range(0, 3), 0],
      scale: [s, s * 0.7, s],
      flat: true,
    });
    for (let tries = 0; tries < 6; tries++) {
      const q = wild();
      if (!free(q, 0.4)) continue;
      staticParts.push(bendGeometry(stone.build(), Frame.fromPoint(q), terrain.heightAt(q)));
      if (s > 0.4) collisions.circle(q, s);
      break;
    }
  }

  // --- Power poles along the main road, with sagging wires between neighbours. ---
  const wirePoints: number[] = [];
  {
    const doors = () => [...gates, ...places.map((pl) => pl.door)];
    let prev: { f: Frame; s: number } | null = null;
    const loopLen = mainEdge.arc[mainEdge.arc.length - 1]!;
    for (let s = 3; s < loopLen; s += 14) {
      let ss = s;
      let f: Frame | null = null;
      for (let tries = 0; tries < 8; tries++, ss += 1.2) {
        const cand = roadsideOf(mainEdge, ss, -1, MAIN_HW + 1.05).frame;
        const ok = !footprints.contains(cand.c, 0.3) && !onRiver(cand.c, 0.5) && !nearJunction(cand.c, 1) && !doors().some((d) => d.distanceTo(cand.c) < 3);
        if (ok) {
          f = cand;
          break;
        }
      }
      if (!f) {
        prev = null;
        continue;
      }
      prop(poleKit(), f);
      collisions.circle(f.c, 0.3);
      footprints.add(f, 1, 1);
      if (prev && ss - prev.s < 22) {
        for (const dz of [-0.6, 0.6]) {
          const A = prev.f.toWorld(0, 6.55, dz);
          const B = f.toWorld(0, 6.55, dz);
          for (let k = 0; k < 12; k++) {
            for (const t of [k / 12, (k + 1) / 12]) {
              const p = new THREE.Vector3().lerpVectors(A, B, t);
              p.setLength(R + 6.55 - 0.7 * 4 * t * (1 - t));
              wirePoints.push(p.x, p.y, p.z);
            }
          }
        }
      }
      prev = { f, s: ss };
    }
  }
  const wires = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wirePoints, 3)),
    new THREE.LineBasicMaterial({ color: 0x283130 }),
  );
  wires.raycast = () => {};
  scene.add(wires);

  // --- Road signs and kiosks along the streets. ---
  {
    const post = (k: Kit, f: Frame) => {
      prop(k, f);
      collisions.circle(f.c, 0.2);
      footprints.add(f, 1.8, 1);
    };
    const doorsNear = (q: THREE.Vector3) => [...gates, ...places.map((pl) => pl.door)].some((d) => d.distanceTo(q) < 3.2);
    const cityFaces = [SIGN.noParking, SIGN.postNoBill, SIGN.slow, SIGN.provisions, SIGN.amala, SIGN.beware419, 12, 13, 14, 15];
    const suburbFaces = [SIGN.left, SIGN.right, SIGN.slow, SIGN.surulere, SIGN.beware419, SIGN.postNoBill, 12, 13, 14, 15];
    const placeSign = (e: RoadEdge, s: number, sideSign: 1 | -1, faces: number[], wide: boolean) => {
      const f = roads.roadside(e, s, sideSign, e.width / 2 + e.shoulder + 0.7);
      if (footprints.contains(f.c, 0.5) || roads.near(f.c, 0.05) || onRiver(f.c, 0.8) || doorsNear(f.c)) return false;
      signs.sign(f, rng.pick(faces) % SIGN_COUNT, post, wide);
      return true;
    };
    for (const e of roads.edges) {
      const len = roads.length(e);
      const faces = e.city ? cityFaces : suburbFaces;
      for (let s = nodeR[e.a]! + 4 + rng.range(0, 10); s < len - nodeR[e.b]! - 2; s += rng.range(28, 45)) {
        placeSign(e, s, rng.chance(0.5) ? 1 : -1, faces, rng.chance(0.25));
      }
    }
    // Arrows and street names at busy junctions.
    roads.nodes.forEach((_, i) => {
      if (roads.degree[i]! < 3) return;
      const e = roads.edges.find((ed) => ed.a === i || ed.b === i)!;
      const s = e.a === i ? nodeR[i]! + 2.5 : roads.length(e) - nodeR[i]! - 2.5;
      placeSign(e, s, rng.chance(0.5) ? 1 : -1, [SIGN.left, SIGN.right, SIGN.surulere, SIGN.ojuelegba], false);
    });
    // A warning by the river.
    {
      const bank = riverAt(0.3);
      const q = surf(bank.lambda + 5 / (R * Math.cos(bank.z / R)), bank.z);
      if (free(q, 0.3)) signs.sign(Frame.fromPoint(q, -Math.PI / 2), SIGN.noSwimming, post);
    }
    // Rubbish heaps: a dark mound with bags and bits, by junctions and on the roadside.
    for (let i = 0, made = 0; i < 200 && made < 9; i++) {
      const e = rng.pick(roads.edges);
      const len = roads.length(e);
      const atEnd = rng.chance(0.6);
      const s = atEnd ? (rng.chance(0.5) ? nodeR[e.a]! + 2 : len - nodeR[e.b]! - 2) : rng.range(3, Math.max(3.1, len - 3));
      // Dumped right at the kerb, spilling onto the gutter edge.
      const f = roads.roadside(e, s, rng.chance(0.5) ? 1 : -1, e.width / 2 + 1);
      if (!roadsideFree(f.c, 0.6, e.shoulder + 0.4) || doorsNear(f.c)) continue;
      const heap = new Kit();
      heap.add(new THREE.IcosahedronGeometry(1, 1), 0x5f5a50, [0, 0.1, 0], { scale: [1.1, 0.45, 0.9] });
      for (let j = 0; j < 9; j++) {
        const a = rng.range(0, Math.PI * 2);
        const r0 = rng.range(0.2, 1);
        const bag = rng.chance(0.5);
        heap.add(bag ? new THREE.IcosahedronGeometry(0.22, 0) : box(0.3, 0.12, 0.2), rng.pick(LITTER), [Math.cos(a) * r0, 0.35 + rng.range(0, 0.2), Math.sin(a) * r0 * 0.8], { rot: [rng.range(0, 3), rng.range(0, 3), 0] });
      }
      prop(heap, f);
      if (made % 3 === 0) smokeSpots.push({ p: f.toWorld(0, 0.6, 0), kind: 'refuse' }); // someone's burning it
      collisions.circle(f.c, 0.9);
      footprints.add(f, 2.4, 2);
      made++;
    }
    // Kiosks dotted along suburban streets.
    for (let i = 0, made = 0; i < 300 && made < 16; i++) {
      const e = rng.pick(roads.edges);
      const s = rng.range(nodeR[e.a]! + 3, Math.max(nodeR[e.a]! + 3.1, roads.length(e) - nodeR[e.b]! - 3));
      // Kiosks sit flush against the road edge, facing the traffic.
      const f = roads.roadside(e, s, rng.chance(0.5) ? 1 : -1, e.width / 2 + 0.95);
      if (!roadsideFree(f.c, 0.6, e.shoulder + 0.4) || doorsNear(f.c)) continue;
      prop(kioskKit(rng.pick(KIOSKS)), f);
      collisions.rect(f, 2.2, 1.6);
      footprints.add(f, 2.8, 2.2);
      made++;
    }
  }

  // --- Poles of the planet: a grove on the mesa up north, a football pitch down south. ---
  const north = new Frame(0, Math.PI / 2);
  const south = new Frame(0, -Math.PI / 2);
  prop(pitchKit(24, 15), south);
  footprints.add(south, 27, 18);
  for (const s of [-1, 1]) for (const dz of [-1.8, 1.8]) collisions.circle(south.toWorld(s * 12, 0, dz), 0.15);
  const polarSpot = (f: Frame, minR: number, maxR: number) => {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(minR, maxR);
    return f.toWorld(Math.cos(a) * r, 0, Math.sin(a) * r);
  };
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < 120 && spots.length < 34; i++) {
    const p = polarSpot(north, 0, POLE_Z - BAND - 3);
    if (spots.some((q) => q.distanceTo(p) < 3.2) || !free(p, 0.5) || terrain.slopeAt(p) > 0.6) continue;
    spots.push(p);
    veg.tree(p, rng.range(0.9, 1.3));
  }
  for (let i = 0; i < 18; i++) {
    const p = polarSpot(south, 15, POLE_Z - BAND - 2);
    if (free(p, 1)) rng.chance(0.6) ? veg.tree(p, rng.range(0.9, 1.2)) : veg.bush(p);
  }

  // --- Greenery: street verges, city street trees, the hub and the far-side bush, grass. ---
  const verge = (p: THREE.Vector3, treeChance: number) => {
    if (!free(p, 0.6)) return;
    if (rng.chance(treeChance)) veg.tree(p, rng.range(0.85, 1.15));
    else veg.bush(p, rng.range(0.7, 1.1));
  };
  for (const e of roads.edges) {
    const len = roads.length(e);
    if (e.city) {
      // Street trees in the pavement every so often.
      for (let s = nodeR[e.a]! + 3; s < len - nodeR[e.b]! - 3; s += rng.range(11, 16)) {
        const f = roads.roadside(e, s, rng.chance(0.5) ? 1 : -1, e.width / 2 + e.shoulder - 0.6);
        if (!footprints.contains(f.c, 0.9) && !nearJunction(f.c, 1.5)) veg.mango(f.c, 0.85);
      }
      continue;
    }
    for (let s = nodeR[e.a]! + 2; s < len - nodeR[e.b]! - 2; s += rng.range(5, 8)) {
      for (const sideSign of [-1, 1] as const) {
        verge(roads.roadside(e, s + rng.range(-1, 1), sideSign, e.width / 2 + e.shoulder + rng.range(1.2, 2.4)).c, 0.35);
      }
    }
  }
  // A few columns of smoke from inside the bush (land clearing, burning).
  for (let i = 0, made = 0; i < 60 && made < 3; i++) {
    const p = wild();
    if (!free(p, 2) || terrain.heightAt(p) > 0.5) continue;
    smokeSpots.push({ p: p.clone().setLength(R + 0.3), kind: 'fire' });
    staticParts.push(new Kit().add(new THREE.RingGeometry(0, 1.2, 10, 2), 0x3d3a34, [0, 0.03, 0], { rot: [-Math.PI / 2, 0, 0] }).bend(Frame.fromPoint(p)).geometry);
    footprints.add(Frame.fromPoint(p), 3, 3);
    made++;
  }
  for (let i = 0; i < 260; i++) {
    const p = wild();
    if (free(p, 1.2)) rng.chance(0.55) ? veg.tree(p, rng.range(0.9, 1.3)) : veg.bush(p, rng.range(0.8, 1.3));
  }
  for (let i = 0; i < 4200; i++) {
    const phi = Math.asin(rng.range(-1, 1));
    const l = rng.range(-Math.PI, Math.PI);
    const p = new Frame(l, phi).c.clone();
    if ((zoneOf(p) !== 'city' || rng.chance(0.12)) && free(p)) veg.tuft(p);
  }

  scene.add(outlinedMesh(mergeGeometries(staticParts, false)!, 0.035));
  veg.addTo(scene);
  signs.addTo(scene, rng);

  // --- Floating rubbish and water hyacinth drifting downstream. ---
  const riverLen = RIVER_SAMPLES.reduce((a, p, i) => (i ? a + p.distanceTo(RIVER_SAMPLES[i - 1]!) : 0), 0);
  const riverAtU = (u: number, lateral: number, out: THREE.Vector3) => {
    const f = THREE.MathUtils.clamp(u, 0, 0.9999) * (RIVER_SAMPLES.length - 1);
    const i = Math.floor(f);
    const a = RIVER_SAMPLES[i]!;
    const b = RIVER_SAMPLES[i + 1]!;
    out.copy(a).lerp(b, f - i);
    const side = new THREE.Vector3().subVectors(b, a).cross(out.clone().normalize()).normalize();
    return out.addScaledVector(side, lateral).setLength(R + 0.03);
  };
  const floaters: { u: number; lat: number; speed: number; spin: number; size: number }[] = [];
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.25, 0.6), toonMaterial(), 46);
  const weeds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1).scale(1, 0.32, 1), toonMaterial(), 16);
  for (let i = 0; i < debris.count + weeds.count; i++) {
    const weed = i >= debris.count;
    floaters.push({
      u: rng.next(),
      lat: rng.range(-RIVER_HW + 0.5, RIVER_HW - 0.5),
      speed: weed ? rng.range(0.08, 0.15) : rng.range(0.25, 0.45),
      spin: rng.range(-0.6, 0.6),
      size: weed ? rng.range(0.5, 1) : rng.range(0.12, 0.3),
    });
    if (weed) weeds.setColorAt(i - debris.count, new THREE.Color(rng.pick([0x4f8f55, 0x5f9e60, 0x6fae68])));
    else debris.setColorAt(i, new THREE.Color(rng.pick(LITTER)));
  }
  for (const m of [debris, weeds]) {
    m.frustumCulled = false;
    m.raycast = () => {};
    scene.add(m);
  }
  const _fp = new THREE.Vector3();
  const _fo = new THREE.Object3D();
  let clock = 0;

  const update = (dt: number) => {
    water.offset.y -= dt * 0.12; // flow south, downstream
    clock += dt;
    floaters.forEach((fl, i) => {
      fl.u = (fl.u + (fl.speed * dt) / riverLen) % 1;
      riverAtU(fl.u, fl.lat + Math.sin(clock * 0.4 + i) * 0.2, _fp);
      _fo.position.copy(_fp);
      _fo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _fp.clone().normalize());
      _fo.rotateY(clock * fl.spin + i);
      // Hidden where a bridge deck covers the water.
      _fo.scale.setScalar(roads.near(_fp, 0.1) ? 0 : fl.size);
      _fo.updateMatrix();
      if (i < debris.count) debris.setMatrixAt(i, _fo.matrix);
      else weeds.setMatrixAt(i - debris.count, _fo.matrix);
    });
    debris.instanceMatrix.needsUpdate = true;
    weeds.instanceMatrix.needsUpdate = true;
  };

  return { ground, places, occluders, collisions, hemi, sun, npcSpots, roads, update, heightAt: (p) => terrain.heightAt(p), smokeSpots };
}
