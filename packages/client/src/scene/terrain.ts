import * as THREE from 'three';
import { Kit } from './kit';
import type { Rng } from './rng';
import { Frame, R } from './sphere';

interface Hill {
  f: Frame;
  r: number;
  h: number;
  /** Flat top with steep rock sides, instead of a soft mound. */
  mesa: boolean;
  wobble: [number, number, number];
}

const _l = new THREE.Vector3();

/**
 * Raised ground on the planet: soft hills and the odd mesa. Everything that stands on the
 * ground (player, trees, rocks) asks heightAt() how far above the base sphere to sit.
 */
export class Terrain {
  readonly hills: Hill[] = [];

  add(f: Frame, r: number, h: number, mesa: boolean, rng: Rng): void {
    this.hills.push({ f, r, h, mesa, wobble: [rng.range(0, 6), rng.range(0, 6), rng.range(0.12, 0.22)] });
  }

  heightAt(p: THREE.Vector3): number {
    let best = 0;
    for (const hill of this.hills) {
      if (p.distanceToSquared(hill.f.c) > (hill.r * 1.3) ** 2) continue;
      hill.f.toLocal(p, _l);
      const a = Math.atan2(_l.z, _l.x);
      // Irregular outline so hills don't look like perfect circles.
      const [p1, p2, amt] = hill.wobble;
      const r = hill.r * (1 + amt * Math.sin(3 * a + p1) + amt * 0.5 * Math.sin(5 * a + p2));
      const t = 1 - Math.hypot(_l.x, _l.z) / r;
      if (t <= 0) continue;
      const shape = hill.mesa ? smooth(Math.min(1, t / 0.28)) : smooth(t);
      best = Math.max(best, hill.h * shape);
    }
    return best;
  }

  /** Steepness (rise over run) at p; used to paint cliffs as rock. */
  slopeAt(p: THREE.Vector3): number {
    const f = Frame.fromPoint(p);
    const h0 = this.heightAt(p);
    const hx = this.heightAt(f.toWorld(0.6, 0, 0));
    const hz = this.heightAt(f.toWorld(0, 0, 0.6));
    return Math.hypot(hx - h0, hz - h0) / 0.6;
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

const ROCK = [0xcbbd94, 0xbfb088, 0xd6c9a2];
const MOSS = [0x5e9b58, 0x6faa62];

/** Sandstone outcrop: a cluster of big faceted rocks with grass on top. */
export function outcropKit(rng: Rng, size: number): { kit: Kit; radius: number } {
  const k = new Kit();
  const n = rng.int(3, 5);
  let radius = 0;
  for (let i = 0; i < n; i++) {
    const s = size * rng.range(0.55, 1);
    const x = rng.range(-1, 1) * size * 0.6;
    const z = rng.range(-1, 1) * size * 0.6;
    const sy = s * rng.range(0.6, 1.1);
    k.add(new THREE.DodecahedronGeometry(1, 0), rng.pick(ROCK), [x, sy * 0.45, z], {
      rot: [rng.range(0, 1), rng.range(0, 6), rng.range(0, 1)],
      scale: [s, sy, s * rng.range(0.8, 1.2)],
      flat: true,
    });
    if (i === 0 || rng.chance(0.4)) {
      k.add(new THREE.IcosahedronGeometry(1, 1), rng.pick(MOSS), [x, sy * 1.3, z], { scale: [s * 0.8, s * 0.22, s * 0.8] });
    }
    radius = Math.max(radius, Math.hypot(x, z) + s * 0.8);
  }
  return { kit: k, radius };
}

/** Natural rock arch, lumpy, with moss along the top. Built as a tube along a half-circle. */
export function archGeometry(rng: Rng, span: number, thickness: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI * (-0.08 + (1.16 * i) / 8);
      return new THREE.Vector3(Math.cos(a) * span * 0.5, Math.sin(a) * span * 0.55 - 0.6, rng.range(-0.3, 0.3));
    }),
  );
  const g = new THREE.TubeGeometry(curve, 28, thickness, 7, false).toNonIndexed();
  const pos = g.attributes.position!;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const bump = 1 + 0.18 * Math.sin(v.x * 1.7 + v.y * 2.3) + 0.12 * Math.sin(v.z * 3.1 + v.x);
    // Push vertices out from the curve a little, unevenly, for a rough rock look.
    v.multiplyScalar(1 + (bump - 1) * 0.05);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  const nor = g.attributes.normal!;
  const rock = new THREE.Color(ROCK[0]);
  const rock2 = new THREE.Color(ROCK[1]);
  const moss = new THREE.Color(MOSS[0]);
  for (let i = 0; i < pos.count; i += 3) {
    // Colour per face so the moss reads as flat painted patches.
    const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
    const c = ny > 0.55 && rng.chance(0.8) ? moss : rng.chance(0.5) ? rock : rock2;
    for (let j = 0; j < 3; j++) colors.set([c.r, c.g, c.b], (i + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Bends a local-space geometry (with position, normal, color) onto the planet around a frame. */
export function bendGeometry(g: THREE.BufferGeometry, f: Frame, lift = 0): THREE.BufferGeometry {
  const pos = g.attributes.position!;
  const nor = g.attributes.normal!;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    f.toWorld(pos.getX(i), pos.getY(i) + lift, pos.getZ(i), v);
    pos.setXYZ(i, v.x, v.y, v.z);
    f.dirToWorld(nor.getX(i), nor.getY(i), nor.getZ(i), v);
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeBoundingSphere();
  return g;
}

export { R };
