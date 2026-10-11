import * as THREE from 'three';
import type { Rng } from './rng';
import { R } from './sphere';

interface Flock {
  axis: THREE.Vector3;
  base: THREE.Vector3;
  speed: number;
  angle: number;
  offsets: THREE.Vector3[];
  phase: number[];
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _local = new THREE.Vector3();

/** Small flocks circling below the camera, so birds cross the screen as you play. */
export class Birds {
  private left: THREE.InstancedMesh;
  private right: THREE.InstancedMesh;
  private flocks: Flock[] = [];
  private t = 0;
  private count = 0;

  constructor(scene: THREE.Scene, rng: Rng, flocks = 5) {
    // One wing: a thin triangle from the body out to +x, hinged at the origin.
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.18, 0, 0, -0.12, 0.55, 0, -0.05], 3));
    wing.computeVertexNormals();
    const mirrored = wing.clone().scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2f3a3a, side: THREE.DoubleSide });
    for (let f = 0; f < flocks; f++) {
      const axis = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
      const base = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
      base.addScaledVector(axis, -base.dot(axis)).setLength(R + rng.range(9, 15));
      const n = rng.int(4, 7);
      const offsets: THREE.Vector3[] = [];
      const phase: number[] = [];
      for (let i = 0; i < n; i++) {
        // Loose V: each bird behind and to the side of the leader.
        const side = i % 2 ? 1 : -1;
        const rank = Math.ceil(i / 2);
        offsets.push(new THREE.Vector3(side * rank * 0.9 + rng.range(-0.2, 0.2), rng.range(-0.3, 0.3), -rank * 0.8));
        phase.push(rng.range(0, Math.PI * 2));
      }
      this.flocks.push({ axis, base, speed: rng.range(0.05, 0.09), angle: rng.range(0, Math.PI * 2), offsets, phase });
      this.count += n;
    }
    this.left = new THREE.InstancedMesh(mirrored, mat, this.count);
    this.right = new THREE.InstancedMesh(wing, mat, this.count);
    for (const m of [this.left, this.right]) {
      m.frustumCulled = false;
      m.raycast = () => {};
      scene.add(m);
    }
  }

  update(dt: number): void {
    this.t += dt;
    let i = 0;
    for (const f of this.flocks) {
      f.angle += f.speed * dt;
      _p.copy(f.base).applyAxisAngle(f.axis, f.angle);
      _n.copy(_p).normalize();
      _s.crossVectors(f.axis, _n).normalize(); // direction of travel
      _e.crossVectors(_n, _s);
      _m.makeBasis(_e, _n, _s).setPosition(_p);
      f.offsets.forEach((off, j) => {
        const flap = Math.sin(this.t * 9 + f.phase[j]!) * 0.6;
        _local.copy(off);
        _w.makeRotationZ(-flap).setPosition(_local);
        this.right.setMatrixAt(i, _m.clone().multiply(_w));
        _w.makeRotationZ(flap).setPosition(_local);
        this.left.setMatrixAt(i, _m.clone().multiply(_w));
        i++;
      });
    }
    this.left.instanceMatrix.needsUpdate = true;
    this.right.instanceMatrix.needsUpdate = true;
  }
}
