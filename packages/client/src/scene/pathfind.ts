import * as THREE from 'three';
import type { Collisions } from './collision';
import { Frame, R } from './sphere';

const CELL = 0.7; // metres
const RADIUS = 40; // search radius in metres around the start
const MAX_EXPANDED = 6000;

/**
 * A* on a small grid laid flat around the player, testing cells against the collision world
 * lazily (only cells the search touches). Returns surface waypoints, or null if unreachable.
 */
export function findPath(collisions: Collisions, from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
  const f = Frame.fromPoint(from);
  const goalL = f.toLocal(to, new THREE.Vector3());
  const n = Math.ceil(RADIUS / CELL);
  const gx = Math.round(goalL.x / CELL);
  const gz = Math.round(goalL.z / CELL);
  if (Math.abs(gx) > n || Math.abs(gz) > n) return null;

  const blockedCache = new Map<number, boolean>();
  const key = (x: number, z: number) => (x + n) * (2 * n + 1) + (z + n);
  const world = (x: number, z: number) => f.toWorld(x * CELL, 0, z * CELL);
  const blocked = (x: number, z: number) => {
    const k = key(x, z);
    let b = blockedCache.get(k);
    if (b === undefined) {
      const p = world(x, z);
      const q = p.clone();
      collisions.resolve(q, 0.45);
      b = q.distanceToSquared(p) > 0.0025;
      blockedCache.set(k, b);
    }
    return b;
  };

  // If the goal itself is inside something, aim for the nearest free cell next to it.
  let tx = gx;
  let tz = gz;
  if (blocked(tx, tz)) {
    let found = false;
    for (let r = 1; r < 6 && !found; r++) {
      for (let dx = -r; dx <= r && !found; dx++) {
        for (const dz of [-r, r]) {
          if (!blocked(gx + dx, gz + dz)) {
            tx = gx + dx;
            tz = gz + dz;
            found = true;
            break;
          }
        }
      }
    }
    if (!found) return null;
  }

  const open: [number, number, number][] = [[0, 0, 0]]; // x, z, f-score
  const g = new Map<number, number>([[key(0, 0), 0]]);
  const came = new Map<number, number>();
  const h = (x: number, z: number) => Math.hypot(x - tx, z - tz);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  let expanded = 0;
  while (open.length && expanded++ < MAX_EXPANDED) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]![2] < open[bi]![2]) bi = i;
    const [x, z] = open.splice(bi, 1)[0]!;
    if (x === tx && z === tz) {
      const cells: [number, number][] = [];
      let k = key(x, z);
      while (k !== key(0, 0)) {
        cells.push([Math.floor(k / (2 * n + 1)) - n, (k % (2 * n + 1)) - n]);
        k = came.get(k)!;
      }
      cells.reverse();
      // Keep every third cell (plus the last) as waypoints; the follower smooths between them.
      const pts = cells.filter((_, i) => i % 3 === 2 || i === cells.length - 1).map(([cx, cz]) => world(cx, cz).setLength(R));
      if (!blocked(gx, gz)) pts[pts.length - 1] = to.clone().setLength(R);
      return pts;
    }
    const gHere = g.get(key(x, z))!;
    for (const [dx, dz] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      if (Math.abs(nx) > n || Math.abs(nz) > n || blocked(nx, nz)) continue;
      // No cutting diagonally between two blocked cells.
      if (dx && dz && (blocked(x + dx, z) || blocked(x, z + dz))) continue;
      const cost = gHere + (dx && dz ? Math.SQRT2 : 1);
      const k = key(nx, nz);
      if (cost < (g.get(k) ?? Infinity)) {
        g.set(k, cost);
        came.set(k, key(x, z));
        open.push([nx, nz, cost + h(nx, nz)]);
      }
    }
  }
  return null;
}
