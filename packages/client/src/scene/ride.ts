import * as THREE from 'three';
import { danfoKit } from './kits';
import type { RoadEdge, RoadNetwork } from './roads';
import { R } from './sphere';
import { toonMaterial, withOutline } from './toon';

const TOP_SPEED = 8; // m/s
const ACCEL = 3;
const BOARDING = 2.8; // seconds waiting at the stop for the danfo to fill up

/** Nearest point along any street: which edge, and how far along it. */
function locate(roads: RoadNetwork, p: THREE.Vector3): { edge: RoadEdge; s: number } {
  let best = Infinity;
  let edge = roads.edges[0]!;
  let s = 0;
  for (const e of roads.edges) {
    e.pts.forEach((q, i) => {
      const d = q.distanceToSquared(p);
      if (d < best) {
        best = d;
        edge = e;
        s = e.arc[i]!;
      }
    });
  }
  return { edge, s };
}

/** Legs of a drive: each is part of one edge, from s0 to s1 (either direction). */
type Leg = { edge: RoadEdge; s0: number; s1: number };

/** Shortest drive along the street graph (Dijkstra over junctions). */
function route(roads: RoadNetwork, from: THREE.Vector3, to: THREE.Vector3): Leg[] {
  const A = locate(roads, from);
  const B = locate(roads, to);
  if (A.edge === B.edge) return [{ edge: A.edge, s0: A.s, s1: B.s }];

  const len = (e: RoadEdge) => roads.length(e);
  const dist = new Map<number, number>();
  const prev = new Map<number, { node: number; edge: RoadEdge } | null>();
  const open: [number, number][] = [];
  const relax = (node: number, d: number, via: { node: number; edge: RoadEdge } | null) => {
    if (d < (dist.get(node) ?? Infinity)) {
      dist.set(node, d);
      prev.set(node, via);
      open.push([node, d]);
    }
  };
  // Leave the start edge by either end.
  relax(A.edge.a, A.s, null);
  relax(A.edge.b, len(A.edge) - A.s, null);
  while (open.length) {
    open.sort((x, y) => x[1] - y[1]);
    const [node, d] = open.shift()!;
    if (d > (dist.get(node) ?? Infinity)) continue;
    for (const e of roads.edges) {
      if (e === A.edge) continue;
      if (e.a === node) relax(e.b, d + len(e), { node, edge: e });
      if (e.b === node) relax(e.a, d + len(e), { node, edge: e });
    }
  }
  // Arrive on the end edge from whichever end is cheaper.
  const viaA = (dist.get(B.edge.a) ?? Infinity) + B.s;
  const viaB = (dist.get(B.edge.b) ?? Infinity) + len(B.edge) - B.s;
  if (!Number.isFinite(Math.min(viaA, viaB))) return [];
  let node = viaA <= viaB ? B.edge.a : B.edge.b;
  const legs: Leg[] = [{ edge: B.edge, s0: node === B.edge.a ? 0 : len(B.edge), s1: B.s }];
  for (let step = prev.get(node); step; step = prev.get(node)) {
    const e = step.edge;
    legs.unshift({ edge: e, s0: step.node === e.a ? 0 : len(e), s1: step.node === e.a ? len(e) : 0 });
    node = step.node;
  }
  legs.unshift({ edge: A.edge, s0: A.s, s1: node === A.edge.a ? 0 : len(A.edge) });
  return legs;
}

/**
 * The player's danfo ride: a danfo waits at the stop to fill up, then drives the streets to the
 * destination in the same lane as the rest of the traffic.
 */
export class DanfoRide {
  readonly mesh: THREE.Mesh;
  private path: THREE.Vector3[] = [];
  private arc: number[] = [];
  private s = 0;
  private speed = 0;
  private wait = 0;
  active = false;

  constructor(
    scene: THREE.Scene,
    private roads: RoadNetwork,
  ) {
    this.mesh = withOutline(new THREE.Mesh(danfoKit().build(), toonMaterial(0xffffff, { vertexColors: true })), 0.05);
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
    scene.add(this.mesh);
  }

  /** Plans the drive; false if no road connects the two points. */
  start(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const legs = route(this.roads, from, to);
    if (!legs.length) return false;
    this.path = [];
    for (const { edge, s0, s1 } of legs) {
      const dir = Math.sign(s1 - s0) || 1;
      const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / 0.8));
      for (let i = 0; i <= n; i++) {
        const { p, side } = this.roads.at(edge, s0 + ((s1 - s0) * i) / n);
        this.path.push(p.addScaledVector(side, (edge.width / 4) * dir).setLength(R));
      }
    }
    this.arc = [0];
    for (let i = 1; i < this.path.length; i++) this.arc.push(this.arc[i - 1]! + this.path[i]!.distanceTo(this.path[i - 1]!));
    this.s = 0;
    this.speed = 0;
    this.wait = BOARDING;
    this.active = true;
    this.mesh.visible = true;
    this.place();
    return true;
  }

  stop(): void {
    this.active = false;
    this.mesh.visible = false;
  }

  get position(): THREE.Vector3 {
    return this.mesh.position.clone();
  }

  get boarding(): boolean {
    return this.wait > 0;
  }

  /** Returns true on arrival. */
  update(dt: number): boolean {
    if (!this.active) return false;
    if (this.wait > 0) {
      this.wait -= dt;
      return false;
    }
    const total = this.arc[this.arc.length - 1]!;
    const left = total - this.s;
    // Ease off into the stop.
    const target = Math.min(TOP_SPEED, Math.sqrt(2 * ACCEL * Math.max(0, left)) + 0.6);
    this.speed += THREE.MathUtils.clamp(target - this.speed, -ACCEL * 2 * dt, ACCEL * dt);
    this.s = Math.min(total, this.s + this.speed * dt);
    this.place();
    return this.s >= total;
  }

  private place(): void {
    let i = 0;
    while (i < this.arc.length - 2 && this.arc[i + 1]! < this.s) i++;
    const a = this.path[i]!;
    const b = this.path[Math.min(i + 1, this.path.length - 1)]!;
    const span = this.arc[i + 1]! - this.arc[i]! || 1;
    const p = a.clone().lerp(b, THREE.MathUtils.clamp((this.s - this.arc[i]!) / span, 0, 1)).setLength(R);
    const up = p.clone().normalize();
    const f = b.clone().sub(a);
    f.addScaledVector(up, -f.dot(up));
    if (f.lengthSq() < 1e-8) return;
    f.normalize();
    const x = new THREE.Vector3().crossVectors(up, f).normalize();
    this.mesh.matrix.makeBasis(x, up, f).setPosition(p);
    this.mesh.matrix.decompose(this.mesh.position, this.mesh.quaternion, this.mesh.scale);
  }
}
