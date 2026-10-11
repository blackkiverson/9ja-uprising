import * as THREE from 'three';
import type { Collisions } from './collision';
import { Kit } from './kit';
import type { Rng } from './rng';
import { Frame } from './sphere';
import { hullGeometry, outlineMaterial, toonMaterial } from './toon';

const _o = new THREE.Object3D();
const _up = new THREE.Vector3(0, 1, 0);
// Local matrix in a ground frame. Euler order XYZ with rx = 0 applies rz (droop/tilt) first, then ry (yaw): what fronds and leaves need.
function m(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _o.position.set(x, y, z);
  _o.rotation.set(rx, ry, rz);
  _o.scale.set(sx, sy, sz);
  _o.updateMatrix();
  return _o.matrix.clone();
}

/** Collects instances of one shape, then draws them all in one call (plus one for the outline). */
class Batch {
  private matrices: THREE.Matrix4[] = [];
  private colors: THREE.Color[] = [];

  constructor(
    private geometry: THREE.BufferGeometry,
    private opts: { outline?: number; material?: THREE.Material } = {},
  ) {}

  add(matrix: THREE.Matrix4, color: THREE.ColorRepresentation): void {
    this.matrices.push(matrix);
    this.colors.push(new THREE.Color(color));
  }

  addTo(scene: THREE.Scene): void {
    const n = this.matrices.length;
    if (!n) return;
    const mesh = new THREE.InstancedMesh(this.geometry, this.opts.material ?? toonMaterial(), n);
    this.matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
    this.colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.computeBoundingSphere();
    mesh.raycast = () => {};
    scene.add(mesh);
    if (this.opts.outline) {
      const hull = new THREE.InstancedMesh(hullGeometry(this.geometry), outlineMaterial(this.opts.outline), n);
      hull.instanceMatrix = mesh.instanceMatrix;
      hull.computeBoundingSphere();
      hull.raycast = () => {};
      scene.add(hull);
    }
  }
}

/** Greyscale leaf speckles; multiplied by each instance's green so canopies look leafy. */
function leafTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 128;
    const y = rnd() * 128;
    g.fillStyle = rnd() < 0.7 ? '#b9c2b9' : '#8f9a90';
    g.beginPath();
    g.ellipse(x, y, 2 + rnd() * 3.5, 1.2 + rnd() * 2, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const CANOPY = [0x3f7a48, 0x4c8a50, 0x5c9a58, 0x356b40, 0x6aa564];
const BUSH = [0x4f8f55, 0x5f9e60, 0x3f7a48, 0x6fae68];
const PALM = [0x4f8d4a, 0x5f9c52, 0x467f45];
const LEAF = [0x7fb35e, 0x8cbf68, 0x6fa556];
const TUFT = [0x6aa564, 0x5c9a58, 0x79b06c, 0x84b878];
const FLAME = [0xb8543f, 0xc8664a, 0xa94a3a];
const BARK = [0x6b625a, 0x5f5850, 0x75695c];
const FLOWERS = [0xd65a5a, 0xe39a4a, 0xe8b8c8, 0xf4f1e6, 0xe9cf6a];

function tuftGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    k.add(new THREE.ConeGeometry(0.08, 0.6, 3).translate(0, 0.3, 0), 0xffffff, [Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12], {
      rot: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35],
    });
  }
  return k.build();
}

/** Lush, soft greenery: mango, palm and plantain trees, flowering bushes and grass tufts. */
export class Vegetation {
  private trunk = new Batch(new THREE.CylinderGeometry(0.2, 0.3, 1, 6).translate(0, 0.5, 0), { outline: 0.04 });
  private blob = new Batch(new THREE.IcosahedronGeometry(1, 1), { outline: 0.03, material: (() => {
    const m = toonMaterial();
    m.map = leafTexture();
    return m;
  })() });
  private frond = new Batch(
    new THREE.ConeGeometry(0.42, 3, 4, 1).rotateZ(-Math.PI / 2).scale(1, 0.25, 1).translate(1.5, 0, 0),
    { outline: 0.025 },
  );
  private leaf = new Batch(new THREE.SphereGeometry(1, 8, 4).scale(1, 0.07, 0.36).translate(1, 0, 0), { outline: 0.025 });
  private flower = new Batch(new THREE.IcosahedronGeometry(1, 0));
  private tufts = new Batch(tuftGeometry());
  private shadow = new Batch(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), {
    material: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }),
  });

  constructor(
    private rng: Rng,
    private collisions: Collisions,
    private heightAt: (p: THREE.Vector3) => number = () => 0,
  ) {}

  /** Ground frame at a world point; local positions below are relative to it. */
  private frame(p: THREE.Vector3): { at: (local: THREE.Matrix4) => THREE.Matrix4 } {
    // Sit on the terrain (hills raise the ground above the base sphere).
    const base = Frame.fromPoint(p).matrix(0, this.heightAt(p), 0);
    return { at: (local) => base.clone().multiply(local) };
  }

  private blobShadow(F: { at: (l: THREE.Matrix4) => THREE.Matrix4 }, r: number): void {
    this.shadow.add(F.at(m(0, 0.045, 0, 0, 0, 0, r)), 0x1f3a3a);
  }

  mango(p: THREE.Vector3, s = 1): void {
    const r = this.rng;
    const F = this.frame(p);
    const h = 2 * s * r.range(0.9, 1.15);
    this.trunk.add(F.at(m(0, 0, 0, 0, r.range(0, 6.28), 0, 1.1 * s, h, 1.1 * s)), 0x6b5444);
    const cy = h + 0.9 * s;
    for (let i = 0; i < 4; i++) {
      const a = i * 2.1 + r.range(0, 1);
      const off = i === 0 ? 0 : 0.95 * s;
      const y = cy + (i === 0 ? 0.55 * s : r.range(-0.2, 0.3) * s);
      this.blob.add(F.at(m(Math.cos(a) * off, y, Math.sin(a) * off, 0, 0, 0, s * r.range(1.25, 1.6))), r.pick(CANOPY));
    }
    this.blobShadow(F, 2.3 * s);
    this.collisions.circle(p, 0.4 * s);
  }

  palm(p: THREE.Vector3, s = 1): void {
    const r = this.rng;
    const F = this.frame(p);
    const h = r.range(5, 6.5) * s;
    const trunk = m(0, 0, 0, r.range(-0.12, 0.12), 0, r.range(-0.12, 0.12), 0.75 * s, h, 0.75 * s);
    this.trunk.add(F.at(trunk), 0x7d6a58);
    const top = _up.clone().applyMatrix4(trunk);
    for (let i = 0; i < 8; i++) {
      const yaw = (i / 8) * Math.PI * 2 + r.range(-0.2, 0.2);
      this.frond.add(F.at(m(top.x, top.y, top.z, 0, yaw, r.range(-0.75, -0.35), s)), r.pick(PALM));
    }
    this.blob.add(F.at(m(top.x, top.y - 0.2, top.z, 0, 0, 0, 0.35 * s)), 0x6b5e3e);
    this.blobShadow(F, 1.6 * s);
    this.collisions.circle(p, 0.35 * s);
  }

  plantain(p: THREE.Vector3, s = 1): void {
    const r = this.rng;
    const F = this.frame(p);
    const h = 1.6 * s * r.range(0.9, 1.2);
    this.trunk.add(F.at(m(0, 0, 0, 0, 0, 0, 0.9 * s, h, 0.9 * s)), 0x7a9455);
    for (let i = 0; i < 6; i++) {
      const yaw = (i / 6) * Math.PI * 2 + r.range(-0.3, 0.3);
      this.leaf.add(F.at(m(0, h, 0, 0, yaw, r.range(0.25, 0.7), s * r.range(0.85, 1.15))), r.pick(LEAF));
    }
    this.blobShadow(F, 1.4 * s);
    this.collisions.circle(p, 0.3 * s);
  }

  /** A clump of leaves: darker underside, lighter top, so each canopy reads as a defined mass. */
  private clump(F: { at: (l: THREE.Matrix4) => THREE.Matrix4 }, x: number, y: number, z: number, size: number, palette: number[], flat = 1): void {
    const r = this.rng;
    const dark = palette.slice().sort((a, b) => new THREE.Color(a).getHSL({ h: 0, s: 0, l: 0 }).l - new THREE.Color(b).getHSL({ h: 0, s: 0, l: 0 }).l);
    this.blob.add(F.at(m(x, y - size * 0.25, z, 0, r.range(0, 6), 0, size * 1.05, size * 0.75 * flat, size * 1.05)), dark[0]!);
    for (let i = 0; i < 3; i++) {
      const a = r.range(0, Math.PI * 2);
      const o = size * 0.45;
      this.blob.add(
        F.at(m(x + Math.cos(a) * o, y + r.range(0, 0.35) * size, z + Math.sin(a) * o, 0, r.range(0, 6), 0, size * r.range(0.6, 0.8), size * r.range(0.5, 0.7) * flat, size * r.range(0.6, 0.8))),
        dark[Math.min(dark.length - 1, 1 + (i % (dark.length - 1)))]!,
      );
    }
  }

  /** Branch from a point on a trunk: returns its tip in the tree's local space. */
  private branch(F: { at: (l: THREE.Matrix4) => THREE.Matrix4 }, from: THREE.Vector3, yaw: number, tilt: number, len: number, thick: number, color: number): THREE.Vector3 {
    // Tilt away from vertical towards the yaw direction.
    const local = new THREE.Matrix4()
      .makeTranslation(from.x, from.y, from.z)
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeRotationZ(-tilt))
      .multiply(new THREE.Matrix4().makeScale(thick, len, thick));
    this.trunk.add(F.at(local), color);
    return _up.clone().applyMatrix4(local);
  }

  /** Tall slender tree with a few branches, each ending in its own clump (like the reference). */
  tall(p: THREE.Vector3, s = 1): void {
    const r = this.rng;
    const F = this.frame(p);
    const bark = r.pick(BARK);
    const h = r.range(5.5, 7.5) * s;
    const top = this.branch(F, new THREE.Vector3(), r.range(0, 6), r.range(0, 0.08), h, 0.65 * s, bark);
    this.clump(F, top.x, top.y + 0.6 * s, top.z, 1.5 * s, CANOPY);
    for (let i = 0, n = r.int(2, 3); i < n; i++) {
      const start = new THREE.Vector3(0, h * r.range(0.45, 0.75), 0);
      const tip = this.branch(F, start, (i / n) * Math.PI * 2 + r.range(-0.4, 0.4), r.range(0.45, 0.8), r.range(1.6, 2.6) * s, 0.35 * s, bark);
      this.clump(F, tip.x, tip.y + 0.4 * s, tip.z, r.range(1, 1.35) * s, CANOPY);
    }
    this.blobShadow(F, 2.2 * s);
    this.collisions.circle(p, 0.35 * s);
  }

  /** Wide umbrella tree; sometimes a flame tree in red-orange bloom. */
  broad(p: THREE.Vector3, s = 1): void {
    const r = this.rng;
    const F = this.frame(p);
    const bark = r.pick(BARK);
    const flame = r.chance(0.3);
    const h = r.range(2.2, 3) * s;
    this.branch(F, new THREE.Vector3(), 0, 0, h, 0.9 * s, bark);
    for (let i = 0, n = r.int(3, 4); i < n; i++) {
      const tip = this.branch(F, new THREE.Vector3(0, h * 0.9, 0), (i / n) * Math.PI * 2 + r.range(-0.3, 0.3), r.range(0.7, 1), r.range(2, 2.8) * s, 0.4 * s, bark);
      this.clump(F, tip.x, tip.y + 0.3 * s, tip.z, r.range(1.4, 1.8) * s, flame && r.chance(0.75) ? FLAME : CANOPY, 0.55);
    }
    this.clump(F, 0, h + 1.6 * s, 0, 1.6 * s, flame ? FLAME : CANOPY, 0.55);
    this.blobShadow(F, 3.2 * s);
    this.collisions.circle(p, 0.45 * s);
  }

  /** Narrow, tall tree: stacked clumps getting smaller towards the top. */
  columnar(p: THREE.Vector3, s = 1): void {
    const r = this.rng;
    const F = this.frame(p);
    this.branch(F, new THREE.Vector3(), 0, 0, 1.4 * s, 0.6 * s, r.pick(BARK));
    for (let i = 0; i < 4; i++) {
      const size = (1.25 - i * 0.22) * s;
      this.blob.add(F.at(m(r.range(-0.1, 0.1), (1.6 + i * 1.15) * s, r.range(-0.1, 0.1), 0, r.range(0, 6), 0, size, size * 1.2, size)), CANOPY[i % 2 ? 0 : 3]!);
    }
    this.blobShadow(F, 1.4 * s);
    this.collisions.circle(p, 0.3 * s);
  }

  /** Random tree: a mix of shapes so no two groves look the same. */
  tree(p: THREE.Vector3, s = 1): void {
    const roll = this.rng.next();
    if (roll < 0.25) this.mango(p, s);
    else if (roll < 0.47) this.tall(p, s);
    else if (roll < 0.65) this.broad(p, s);
    else if (roll < 0.78) this.palm(p, s);
    else if (roll < 0.9) this.plantain(p, s);
    else this.columnar(p, s);
  }

  bush(p: THREE.Vector3, s = 1, flowers = this.rng.chance(0.45)): void {
    const r = this.rng;
    const F = this.frame(p);
    const blobs: [number, number, number, number][] = [];
    for (let i = 0, n = r.int(2, 3); i < n; i++) {
      const bx = r.range(-0.5, 0.5) * s;
      const bz = r.range(-0.5, 0.5) * s;
      const sc = r.range(0.55, 0.9) * s;
      const by = sc * 0.7;
      this.blob.add(F.at(m(bx, by, bz, 0, 0, 0, sc, sc * 0.8, sc)), r.pick(BUSH));
      blobs.push([bx, by, bz, sc]);
    }
    if (flowers) {
      const color = r.pick(FLOWERS);
      for (let i = 0, n = r.int(5, 9); i < n; i++) {
        const [bx, by, bz, sc] = r.pick(blobs);
        const theta = r.range(0, Math.PI * 2);
        const phi = r.range(0.2, 1.2);
        this.flower.add(
          F.at(m(bx + Math.cos(theta) * Math.sin(phi) * sc, by + Math.cos(phi) * sc * 0.8, bz + Math.sin(theta) * Math.sin(phi) * sc, 0, 0, 0, 0.11)),
          color,
        );
      }
    }
    this.blobShadow(F, 1.1 * s);
  }

  tuft(p: THREE.Vector3): void {
    this.tufts.add(this.frame(p).at(m(0, 0, 0, 0, this.rng.range(0, 6.28), 0, this.rng.range(0.8, 1.4))), this.rng.pick(TUFT));
  }

  addTo(scene: THREE.Scene): void {
    for (const b of [this.trunk, this.blob, this.frond, this.leaf, this.flower, this.tufts, this.shadow]) b.addTo(scene);
  }
}
