import * as THREE from 'three';
import { Kit } from './kit';
import type { Rng } from './rng';
import { R } from './sphere';
import { toonMaterial, withOutline } from './toon';

interface Cloud {
  mesh: THREE.Mesh;
  axis: THREE.Vector3;
  base: THREE.Vector3;
  speed: number;
  angle: number;
  radius: number;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _seg = new THREE.Line3();
const _closest = new THREE.Vector3();

/**
 * Toon clouds drifting round the planet on a shared wind with per-cloud variation,
 * so they drift in and out of view as you walk. Each fades if it hides the player.
 */
export class Clouds {
  private clouds: Cloud[] = [];

  constructor(scene: THREE.Scene, rng: Rng, count = 18) {
    const wind = new THREE.Vector3(0.15, 1, 0.1).normalize();
    for (let i = 0; i < count; i++) {
      const k = new Kit();
      const puffs = rng.int(4, 7);
      const span = rng.range(4, 7);
      for (let j = 0; j < puffs; j++) {
        const t = puffs === 1 ? 0 : j / (puffs - 1) - 0.5;
        const size = rng.range(1.1, 2) * (1 - Math.abs(t) * 0.8);
        k.add(new THREE.IcosahedronGeometry(1, 1), rng.pick([0xffffff, 0xf6f8f7, 0xeef3f2]), [
          t * span + rng.range(-0.6, 0.6),
          rng.range(0, 0.8),
          rng.range(-1.2, 1.2),
        ], { scale: [size, size * 0.72, size] });
      }
      const geometry = k.build();
      const material = toonMaterial(0xffffff, { vertexColors: true });
      material.emissive.setHex(0x3a3a3a); // lift the shaded bands so clouds read white, not cream
      const mesh = withOutline(new THREE.Mesh(geometry, material), 0.06);
      mesh.matrixAutoUpdate = false;
      mesh.raycast = () => {};
      scene.add(mesh);

      const axis = wind
        .clone()
        .add(new THREE.Vector3(rng.range(-0.5, 0.5), rng.range(-0.2, 0.2), rng.range(-0.5, 0.5)))
        .normalize();
      // Start on the great circle around the cloud's own axis, at its cruising height.
      const base = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
      base.addScaledVector(axis, -base.dot(axis));
      if (base.lengthSq() < 1e-4) base.set(1, 0, 0).addScaledVector(axis, -axis.x);
      base.setLength(R + rng.range(18, 23)); // just above the tallest rooftops, below the camera
      this.clouds.push({ mesh, axis, base, speed: rng.range(0.012, 0.03), angle: rng.range(0, Math.PI * 2), radius: span / 2 + 3 });
    }
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3 | null): void {
    if (focus) {
      _seg.start.copy(camera.position);
      _seg.end.copy(focus).addScaledVector(_n.copy(focus).normalize(), 1.5);
    }
    for (const c of this.clouds) {
      c.angle += c.speed * dt;
      _p.copy(c.base).applyAxisAngle(c.axis, c.angle);
      // Flat side to the planet, long side along the direction of travel.
      _n.copy(_p).normalize();
      _e.crossVectors(c.axis, _n).normalize();
      _s.crossVectors(_e, _n);
      _m.makeBasis(_e, _n, _s).setPosition(_p);
      c.mesh.matrix.copy(_m);

      const mat = c.mesh.material as THREE.MeshToonMaterial;
      let goal = 1;
      if (focus) {
        // Fade clouds that hide the player or drift right up to the lens.
        _seg.closestPointToPoint(_p, true, _closest);
        if (_closest.distanceTo(_p) < c.radius) goal = 0.25;
        const near = camera.position.distanceTo(_p);
        if (near < 18) goal = Math.min(goal, Math.max(0, (near - 8) / 10));
      }
      if (mat.opacity !== goal) {
        mat.opacity += (goal - mat.opacity) * (1 - Math.exp(-8 * dt));
        if (Math.abs(mat.opacity - goal) < 0.01) mat.opacity = goal;
        mat.transparent = mat.opacity < 1;
        for (const child of c.mesh.children) child.visible = mat.opacity > 0.9;
      }
    }
  }
}
