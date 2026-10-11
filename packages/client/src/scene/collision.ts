import * as THREE from 'three';
import { Frame, R } from './sphere';

type Collider =
  | { kind: 'rect'; f: Frame; hw: number; hd: number; reach2: number }
  | { kind: 'circle'; p: THREE.Vector3; r: number };

const _l = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Collision on the planet surface. Rects live in their own local frame (so they work anywhere,
 * including near the poles); circles are 3D points. Placeholder until navmesh + three-mesh-bvh.
 */
export class Collisions {
  private colliders: Collider[] = [];

  /** Rect of w x d metres in the frame's local axes (honours the frame's yaw). */
  rect(f: Frame, w: number, d: number): void {
    const reach = Math.hypot(w, d) / 2 + 2;
    this.colliders.push({ kind: 'rect', f, hw: w / 2, hd: d / 2, reach2: reach * reach });
  }

  circle(p: THREE.Vector3, r: number): void {
    this.colliders.push({ kind: 'circle', p: p.clone(), r });
  }

  /** Pushes a circle of radius r at p (on the surface) out of every collider. Mutates p. */
  resolve(p: THREE.Vector3, r = 0.4): void {
    // A few passes, so being pushed out of one collider into its neighbour (corners, seams) settles.
    for (let pass = 0; pass < 3; pass++) {
      const before = p.clone();
      this.resolveOnce(p, r);
      if (before.distanceToSquared(p) < 1e-8) break;
    }
  }

  private resolveOnce(p: THREE.Vector3, r: number): void {
    for (const c of this.colliders) {
      if (c.kind === 'circle') {
        const min = r + c.r;
        if (p.distanceToSquared(c.p) > (min + 1) ** 2) continue;
        _n.copy(p).normalize();
        _d.subVectors(p, c.p);
        _d.addScaledVector(_n, -_d.dot(_n));
        const dist = _d.length();
        if (dist < min && dist > 1e-6) p.addScaledVector(_d, (min - dist) / dist);
        continue;
      }
      if (p.distanceToSquared(c.f.c) > c.reach2) continue;
      const l = c.f.toLocal(p, _l);
      let x = l.x;
      let z = l.z;
      const nx = Math.max(-c.hw, Math.min(x, c.hw));
      const nz = Math.max(-c.hd, Math.min(z, c.hd));
      const dx = x - nx;
      const dz = z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        if (d >= r) continue;
        x += (dx * (r - d)) / d;
        z += (dz * (r - d)) / d;
      } else {
        // Centre is inside the rect: push out along the shallowest side.
        const left = x + c.hw;
        const right = c.hw - x;
        const back = z + c.hd;
        const front = c.hd - z;
        const m = Math.min(left, right, back, front);
        if (m === left) x = -c.hw - r;
        else if (m === right) x = c.hw + r;
        else if (m === back) z = -c.hd - r;
        else z = c.hd + r;
      }
      c.f.toWorld(x, 0, z, p);
    }
    p.normalize().multiplyScalar(R);
  }
}

/** Occupied ground used while generating the world, so scattered greenery avoids buildings. */
export class Footprints {
  private rects: { f: Frame; hw: number; hd: number; reach2: number }[] = [];

  add(f: Frame, w: number, d: number): void {
    const reach = Math.hypot(w, d) / 2 + 3;
    this.rects.push({ f, hw: w / 2, hd: d / 2, reach2: reach * reach });
  }

  contains(p: THREE.Vector3, pad = 0): boolean {
    for (const r of this.rects) {
      if (p.distanceToSquared(r.f.c) > r.reach2) continue;
      const l = r.f.toLocal(p, _l);
      if (Math.abs(l.x) < r.hw + pad && Math.abs(l.z) < r.hd + pad) return true;
    }
    return false;
  }

  /**
   * True if a w x d rect in frame f overlaps any footprint grown by pad. A proper separating-axis
   * test in each footprint's tangent plane, so thin walls and rotated plots can't slip between
   * sample points.
   */
  overlaps(f: Frame, w: number, d: number, pad = 0): boolean {
    const own = Math.hypot(w, d) / 2 + pad;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => f.toWorld((sx! * w) / 2, 0, (sz! * d) / 2));
    const q: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
    for (const r of this.rects) {
      const reach = Math.sqrt(r.reach2) - 3 + own;
      if (f.c.distanceToSquared(r.f.c) > reach * reach) continue;
      corners.forEach((c, i) => {
        r.f.toLocal(c, _l);
        q[i]![0] = _l.x;
        q[i]![1] = _l.z;
      });
      const hw = r.hw + pad;
      const hd = r.hd + pad;
      const ux = q[1]![0] - q[0]![0];
      const uz = q[1]![1] - q[0]![1];
      const axes: [number, number][] = [[1, 0], [0, 1], [ux, uz], [-uz, ux]];
      let separated = false;
      for (const [ax, az] of axes) {
        const boxR = Math.abs(ax) * hw + Math.abs(az) * hd;
        let lo = Infinity;
        let hi = -Infinity;
        for (const [x, z] of q) {
          const t = x * ax + z * az;
          lo = Math.min(lo, t);
          hi = Math.max(hi, t);
        }
        if (lo > boxR || hi < -boxR) {
          separated = true;
          break;
        }
      }
      if (!separated) return true;
    }
    return false;
  }
}
