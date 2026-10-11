import * as THREE from 'three';

/** Planet radius in metres. ~264 m round the equator: about 45 seconds' walk. */
export const R = 42;
/** Distance from the equator to a pole, in metres. */
export const POLE_Z = (Math.PI / 2) * R;

const _v = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A small local flat patch on the planet: x = east, y = up, z = south (rotated by yaw).
 * Everything is authored flat in a frame and then placed or bent onto the sphere.
 * Chart coordinates (x, z) are metres: z south of the equator, x east along the latitude ring.
 */
export class Frame {
  readonly n = new THREE.Vector3();
  readonly e = new THREE.Vector3();
  readonly s = new THREE.Vector3();
  readonly c = new THREE.Vector3();

  constructor(
    readonly lambda: number,
    readonly phi: number,
    yaw = 0,
  ) {
    const cl = Math.cos(lambda);
    const sl = Math.sin(lambda);
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    this.n.set(cp * sl, sp, cp * cl);
    const east = new THREE.Vector3(cl, 0, -sl);
    const south = new THREE.Vector3().crossVectors(east, this.n);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // Same convention as Object3D.rotation.y, so kits authored facing +z turn as expected.
    this.e.copy(east).multiplyScalar(cy).addScaledVector(south, -sy);
    this.s.copy(east).multiplyScalar(sy).addScaledVector(south, cy);
    this.c.copy(this.n).multiplyScalar(R);
  }

  /** Frame at chart metres (x east along the ring, z south of the equator). */
  static at(x: number, z: number, yaw = 0): Frame {
    const phi = -z / R;
    return new Frame(x / (R * Math.max(Math.cos(phi), 1e-3)), phi, yaw);
  }

  static fromPoint(p: THREE.Vector3, yaw = 0): Frame {
    const n = _v.copy(p).normalize();
    return new Frame(Math.atan2(n.x, n.z), Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)), yaw);
  }

  /** Local point to world, bent onto the sphere: y is height above the ground. */
  toWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out
      .copy(this.c)
      .addScaledVector(this.e, x)
      .addScaledVector(this.s, z)
      .normalize()
      .multiplyScalar(R + y);
  }

  /** World point to local tangent coordinates. Linear, so segments stay segments. */
  toLocal(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const v = _v.subVectors(p, this.c);
    return out.set(v.dot(this.e), v.dot(this.n), v.dot(this.s));
  }

  dirToWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 0, 0).addScaledVector(this.e, x).addScaledVector(this.n, y).addScaledVector(this.s, z);
  }

  /** Rigid placement (no bending) for small things: trees, people, props. */
  matrix(x = 0, y = 0, z = 0): THREE.Matrix4 {
    const p = this.toWorld(x, y, z);
    return new THREE.Matrix4().makeBasis(this.e, this.n, this.s).setPosition(p);
  }
}

export const pointAt = (x: number, z: number, y = 0) => Frame.at(x, z).toWorld(0, y, 0);

/** Latitude/longitude of a world point, plus chart metres. */
export function chartOf(p: THREE.Vector3): { lambda: number; phi: number; z: number } {
  const n = _v.copy(p).normalize();
  const phi = Math.asin(THREE.MathUtils.clamp(n.y, -1, 1));
  return { lambda: Math.atan2(n.x, n.z), phi, z: -phi * R };
}

/** Tangent direction pointing north at p (any tangent if p is at a pole). */
export function northAt(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const n = _v.copy(p).normalize();
  out.copy(WORLD_UP).addScaledVector(n, -n.dot(WORLD_UP));
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0).addScaledVector(n, -n.x);
  return out.normalize();
}

/** Nearest hit of a ray with the planet surface, or null. */
export function raySphere(ray: THREE.Ray, radius = R): THREE.Vector3 | null {
  const b = ray.origin.dot(ray.direction);
  const c = ray.origin.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? ray.at(t, new THREE.Vector3()) : null;
}
