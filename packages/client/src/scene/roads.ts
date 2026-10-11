import * as THREE from 'three';
import type { Rng } from './rng';
import { Frame, R, chartOf } from './sphere';

export type RoadKind = 'main' | 'street' | 'lane';

export interface RoadEdge {
  a: number;
  b: number;
  /** Polyline on the surface, ~0.8 m apart, from node a to node b. */
  pts: THREE.Vector3[];
  /** Cumulative arc length at each point. */
  arc: number[];
  width: number;
  kind: RoadKind;
  surface: 'asphalt' | 'laterite';
  /** City streets get gutters and pavements. */
  city: boolean;
  /** Extra width beside the carriageway (gutters, pavements, verges) on each side. */
  shoulder: number;
}

export interface RoadOptions {
  /** Junction spacing in metres at a point (denser in the city). */
  spacing: (p: THREE.Vector3) => number;
  /** Where junctions may not go (hub, river, poles). */
  blocked: (p: THREE.Vector3) => boolean;
  /** Where streets may not pass (hub, ponds); the main loop ignores this. */
  edgeBlocked: (p: THREE.Vector3) => boolean;
  /** Zone of a point: decides street type. */
  zone: (p: THREE.Vector3) => 'city' | 'suburb' | 'green';
  /** Main loop as a closed polyline (from mainLoop()). */
  loop: THREE.Vector3[];
  /** Latitude band (|z| metres) the street web fills. */
  band: number;
  /** Most streets meeting at one junction. */
  maxDegree?: number;
  /** Keep at most this many non-main streets (pruned without disconnecting anything). */
  maxStreets?: number;
}

const STEP = 0.8;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

const surfacePoint = (lambda: number, z: number) => new Frame(lambda, -z / R).c.clone();

/** Points from a to b along the sphere, bowed sideways a little so streets are never ruler-straight. */
function curve(a: THREE.Vector3, b: THREE.Vector3, bow: number, wiggle: number): THREE.Vector3[] {
  const len = a.distanceTo(b);
  const n = Math.max(2, Math.ceil(len / STEP));
  const mid = a.clone().add(b).normalize();
  const side = new THREE.Vector3().subVectors(b, a).cross(mid).normalize();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    const off = bow * Math.sin(Math.PI * t) + wiggle * Math.sin(Math.PI * 3 * t);
    pts.push(p.addScaledVector(side, off).setLength(R));
  }
  return pts;
}

function arcOf(pts: THREE.Vector3[]): number[] {
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
  return arc;
}

/** 2D segment intersection in a shared tangent frame (endpoints excluded). */
function crosses(f: Frame, a1: THREE.Vector3, a2: THREE.Vector3, b1: THREE.Vector3, b2: THREE.Vector3): boolean {
  const p = f.toLocal(a1, new THREE.Vector3());
  const q = f.toLocal(a2, new THREE.Vector3());
  const r = f.toLocal(b1, new THREE.Vector3());
  const s = f.toLocal(b2, new THREE.Vector3());
  const d = (q.x - p.x) * (s.z - r.z) - (q.z - p.z) * (s.x - r.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((r.x - p.x) * (s.z - r.z) - (r.z - p.z) * (s.x - r.x)) / d;
  const u = ((r.x - p.x) * (q.z - p.z) - (r.z - p.z) * (q.x - p.x)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

/**
 * The street web: a winding main loop plus a planar graph of streets and lanes between scattered
 * junctions. Doubles as the future traffic graph (nodes = junctions, edges = streets).
 */
export class RoadNetwork {
  readonly nodes: THREE.Vector3[] = [];
  readonly edges: RoadEdge[] = [];
  readonly degree: number[] = [];
  /** The main loop as one closed polyline, for placing things along it. */
  loop: THREE.Vector3[] = [];
  loopArc: number[] = [];
  private index = new Map<string, { p: THREE.Vector3; hw: number }[]>();
  private static CELL = 6;

  constructor(rng: Rng, o: RoadOptions) {
    // 1. Main loop: winds north and south as it circles the planet.
    this.loop = o.loop;
    const LOOP_PTS = this.loop.length;
    this.loopArc = arcOf([...this.loop, this.loop[0]!]);
    const loopNodeIdx: number[] = [];
    for (let i = 0; i < LOOP_PTS; i += 30) {
      if (o.blocked(this.loop[i]!)) continue;
      loopNodeIdx.push(i);
      this.addNode(this.loop[i]!);
    }
    for (let k = 0; k < loopNodeIdx.length; k++) {
      const i0 = loopNodeIdx[k]!;
      const i1 = loopNodeIdx[(k + 1) % loopNodeIdx.length]!;
      const pts: THREE.Vector3[] = [];
      for (let i = i0; ; i = (i + 1) % LOOP_PTS) {
        pts.push(this.loop[i]!.clone());
        if (i === i1) break;
      }
      this.addEdge(k, (k + 1) % loopNodeIdx.length, pts, 'main', o);
    }
    const loopNodes = this.nodes.length;

    // 2. Junctions scattered over the band (Poisson disc: denser in the city).
    const nearLoop = (p: THREE.Vector3, d: number) => this.loop.some((q) => q.distanceToSquared(p) < d * d);
    for (let tries = 0; tries < 5000; tries++) {
      const z = rng.range(-o.band, o.band);
      const p = surfacePoint(rng.range(-Math.PI, Math.PI), z);
      if (o.blocked(p)) continue;
      const s = o.spacing(p);
      if (this.nodes.some((q) => q.distanceTo(p) < s)) continue;
      if (nearLoop(p, s * 0.55)) continue;
      this.addNode(p);
    }

    // 3. Join junctions: shortest first, no crossings, no sharp angles, at most 4 streets per junction.
    const cands: [number, number, number][] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        if (i < loopNodes && j < loopNodes) continue;
        const d = this.nodes[i]!.distanceTo(this.nodes[j]!);
        const max = 1.9 * Math.max(o.spacing(this.nodes[i]!), o.spacing(this.nodes[j]!));
        if (d < max) cands.push([d, i, j]);
      }
    }
    cands.sort((x, y) => x[0] - y[0]);
    const parent = this.nodes.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const maxDeg = o.maxDegree ?? 4;
    const tryEdge = (i: number, j: number, ignoreDegree: boolean) => {
      if (!ignoreDegree && (this.degree[i]! >= maxDeg || this.degree[j]! >= maxDeg)) return false;
      const a = this.nodes[i]!;
      const b = this.nodes[j]!;
      // Streets keep out of blocked areas (sampled along the straight line).
      for (let t = 0.1; t < 0.95; t += 0.1) if (o.edgeBlocked(a.clone().lerp(b, t).setLength(R))) return false;
      const f = Frame.fromPoint(a.clone().add(b));
      for (const e of this.edges) {
        if (e.a === i || e.a === j || e.b === i || e.b === j) continue;
        // Test against the edge's own polyline in coarse steps (handles the curvy main loop).
        const stride = Math.max(1, Math.floor(e.pts.length / 8));
        for (let k = 0; k + stride < e.pts.length; k += stride) {
          const p = e.pts[k]!;
          const q = e.pts[Math.min(k + stride, e.pts.length - 1)]!;
          if (p.distanceToSquared(f.c) > 70 * 70) continue;
          if (crosses(f, a, b, p, q)) return false;
        }
      }
      // Avoid slivers: streets meeting at a junction must open at least ~32 degrees apart.
      for (const [n, other] of [[i, j], [j, i]] as const) {
        const here = this.nodes[n]!;
        const fn = Frame.fromPoint(here);
        const dir = fn.toLocal(this.nodes[other]!, _a).setY(0).normalize().clone();
        for (const e of this.edges) {
          if (e.a !== n && e.b !== n) continue;
          const next = e.a === n ? e.pts[Math.min(3, e.pts.length - 1)]! : e.pts[Math.max(0, e.pts.length - 4)]!;
          const d2 = fn.toLocal(next, _b).setY(0).normalize();
          if (dir.dot(d2) > Math.cos(THREE.MathUtils.degToRad(32))) return false;
        }
      }
      const len = a.distanceTo(b);
      const zone = o.zone(a.clone().add(b).setLength(R));
      const kind: RoadKind = zone === 'city' ? (rng.chance(0.25) ? 'lane' : 'street') : zone === 'suburb' ? (rng.chance(0.4) ? 'lane' : 'street') : 'lane';
      this.addEdge(i, j, curve(a, b, rng.range(-0.05, 0.05) * len, rng.range(-0.35, 0.35)), kind, o);
      parent[find(i)] = find(j);
      return true;
    };
    for (let k = 0; k < loopNodes; k++) parent[find(k)] = find(0);
    for (const [, i, j] of cands) tryEdge(i, j, false);
    // Make sure every cluster joins the rest (one extra link each, degree limit relaxed).
    for (const [, i, j] of cands) if (find(i) !== find(j)) tryEdge(i, j, true);

    // Thin the web: drop random streets that aren't needed to keep everything connected.
    if (o.maxStreets !== undefined) {
      const connected = (skip: RoadEdge) => {
        const par = this.nodes.map((_, i) => i);
        const f = (i: number): number => (par[i] === i ? i : (par[i] = f(par[i]!)));
        for (const e of this.edges) if (e !== skip) par[f(e.a)] = f(e.b);
        const used = new Set<number>();
        for (const e of this.edges) if (e !== skip) used.add(e.a).add(e.b);
        const roots = new Set([...used].map(f));
        return roots.size <= 1;
      };
      let streets = this.edges.filter((e) => e.kind !== 'main');
      for (const e of [...streets].sort(() => rng.next() - 0.5)) {
        if (streets.length <= o.maxStreets) break;
        if (!connected(e)) continue;
        this.edges.splice(this.edges.indexOf(e), 1);
        this.degree[e.a]!--;
        this.degree[e.b]!--;
        streets = streets.filter((x) => x !== e);
      }
      // Junctions left with no streets disappear.
      this.isolated = new Set(this.nodes.map((_, i) => i).filter((i) => this.degree[i] === 0));
    }

    for (const e of this.edges) {
      for (const p of e.pts) this.indexPoint(p, e.width / 2 + e.shoulder);
    }
    this.nodes.forEach((p, i) => {
      if (!this.isolated.has(i)) this.indexPoint(p, this.junctionRadius(i) + 0.6);
    });
  }

  /** Junctions that lost all their streets when the web was thinned. */
  isolated = new Set<number>();

  /** Closest point on any street to p, with the direction from p towards it. */
  nearest(p: THREE.Vector3): { point: THREE.Vector3; toward: THREE.Vector3; dist: number; edge: RoadEdge } {
    let best = Infinity;
    let point = p;
    let edge = this.edges[0]!;
    for (const e of this.edges) {
      for (let i = 0; i < e.pts.length; i += 2) {
        const d = e.pts[i]!.distanceToSquared(p);
        if (d < best) {
          best = d;
          point = e.pts[i]!;
          edge = e;
        }
      }
    }
    return { point, toward: point.clone().sub(p).normalize(), dist: Math.sqrt(best), edge };
  }

  private addNode(p: THREE.Vector3): void {
    this.nodes.push(p.clone().setLength(R));
    this.degree.push(0);
  }

  private addEdge(a: number, b: number, pts: THREE.Vector3[], kind: RoadKind, o: RoadOptions): void {
    const mid = pts[Math.floor(pts.length / 2)]!;
    const city = o.zone(mid) === 'city';
    const width = kind === 'main' ? 6 : kind === 'street' ? (city ? 4.4 : 4) : 3;
    const surface = kind === 'main' || city ? 'asphalt' : 'laterite';
    const gutters = kind === 'main' || (city && kind === 'street');
    const shoulder = (gutters ? 0.6 : 0.2) + (city ? 1.5 : 0);
    this.edges.push({ a, b, pts, arc: arcOf(pts), width, kind, surface, city, shoulder });
    this.degree[a]!++;
    this.degree[b]!++;
  }

  junctionRadius(node: number): number {
    let w = 0;
    for (const e of this.edges) if (e.a === node || e.b === node) w = Math.max(w, e.width);
    return w / 2 + 0.4;
  }

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private indexPoint(p: THREE.Vector3, hw: number): void {
    const c = RoadNetwork.CELL;
    const k = this.key(Math.floor(p.x / c), Math.floor(p.y / c), Math.floor(p.z / c));
    let list = this.index.get(k);
    if (!list) this.index.set(k, (list = []));
    list.push({ p, hw });
  }

  /** True if p is on a road (carriageway plus gutters/pavements), within pad metres. */
  near(p: THREE.Vector3, pad = 0): boolean {
    const c = RoadNetwork.CELL;
    const cx = Math.floor(p.x / c);
    const cy = Math.floor(p.y / c);
    const cz = Math.floor(p.z / c);
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let z = cz - 1; z <= cz + 1; z++) {
          const list = this.index.get(this.key(x, y, z));
          if (!list) continue;
          for (const e of list) {
            const lim = e.hw + pad + STEP / 2;
            if (e.p.distanceToSquared(p) < lim * lim) return true;
          }
        }
      }
    }
    return false;
  }

  /** Point, direction of travel and right-hand side at arc length s along an edge. */
  at(e: RoadEdge, s: number): { p: THREE.Vector3; t: THREE.Vector3; side: THREE.Vector3 } {
    const s2 = THREE.MathUtils.clamp(s, 0, e.arc[e.arc.length - 1]!);
    let i = 0;
    while (i < e.arc.length - 2 && e.arc[i + 1]! < s2) i++;
    const span = e.arc[i + 1]! - e.arc[i]! || 1;
    const p = e.pts[i]!.clone().lerp(e.pts[i + 1]!, (s2 - e.arc[i]!) / span).setLength(R);
    const t = new THREE.Vector3().subVectors(e.pts[i + 1]!, e.pts[i]!).normalize();
    const side = t.clone().cross(p.clone().normalize()).normalize();
    return { p, t, side };
  }

  /** A frame beside an edge: dist metres to one side, its +z facing the road. */
  roadside(e: RoadEdge, s: number, sideSign: 1 | -1, dist: number): Frame {
    const { p, side } = this.at(e, s);
    const c = p.clone().addScaledVector(side, sideSign * dist).setLength(R);
    return facing(c, side.clone().multiplyScalar(-sideSign));
  }

  length(e: RoadEdge): number {
    return e.arc[e.arc.length - 1]!;
  }

  zoneOf(p: THREE.Vector3): number {
    return chartOf(p).lambda;
  }
}

/** Main road loop: winds north and south as it circles the planet. */
export function mainLoop(loopZ: (lambda: number) => number, n = 360): THREE.Vector3[] {
  return Array.from({ length: n }, (_, i) => {
    const l = -Math.PI + (i / n) * Math.PI * 2;
    return surfacePoint(l, loopZ(l));
  });
}

/** Treats the closed main loop as one long edge, for placing things along it. */
export function loopEdge(loop: THREE.Vector3[]): RoadEdge {
  const pts = [...loop, loop[0]!].map((p) => p.clone());
  return { a: -1, b: -1, pts, arc: arcOf(pts), width: 6, kind: 'main', surface: 'asphalt', city: false, shoulder: 0.6 };
}

/** Frame at point c whose local +z points along dir (projected onto the ground). */
export function facing(c: THREE.Vector3, dir: THREE.Vector3): Frame {
  const f = Frame.fromPoint(c);
  return new Frame(f.lambda, f.phi, Math.atan2(dir.dot(f.e), dir.dot(f.s)));
}
