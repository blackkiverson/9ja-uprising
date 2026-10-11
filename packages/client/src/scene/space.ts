import * as THREE from 'three';
import type { Rng } from './rng';
import { R } from './sphere';
import { hullGeometry, outlineMaterial } from './toon';

interface Drifter {
  axis: THREE.Vector3;
  base: THREE.Vector3;
  speed: number;
  angle: number;
  spin: THREE.Vector3;
  scale: number;
}

const _o = new THREE.Object3D();

/**
 * The space around the planet, in tones close to the sky: slow-drifting rocks, tiny specks and
 * soft lighter-teal haze. Unlit so it reads as flat shapes, like the Messenger reference.
 */
export class Space {
  private rocks: THREE.InstancedMesh;
  private rockHull: THREE.InstancedMesh;
  private specks: THREE.InstancedMesh;
  private drifters: Drifter[] = [];
  private speckDrift: Drifter[] = [];
  private haze = new THREE.Group();
  private t = 0;
  private hazeMat!: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, rng: Rng) {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const ROCK_COUNT = 110;
    this.rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), ROCK_COUNT);
    this.rockHull = new THREE.InstancedMesh(hullGeometry(rockGeo), outlineMaterial(0.08), ROCK_COUNT);
    this.rockHull.instanceMatrix = this.rocks.instanceMatrix;
    // Per-rock shade only; the hue comes from the material, which follows the time of day.
    const rockShades = [1, 0.94, 0.78, 1.06, 0.7];
    for (let i = 0; i < ROCK_COUNT; i++) {
      this.drifters.push(this.drifter(rng, rng.range(R + 45, R + 130), rng.range(0.3, 2.2)));
      const k = rng.pick(rockShades);
      this.rocks.setColorAt(i, new THREE.Color(k, k, k));
    }

    const SPECK_COUNT = 320;
    this.specks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), SPECK_COUNT);
    for (let i = 0; i < SPECK_COUNT; i++) {
      this.speckDrift.push(this.drifter(rng, rng.range(R + 40, R + 160), rng.range(0.12, 0.35)));
      const k = rng.pick([1, 0.92, 1.08]);
      this.specks.setColorAt(i, new THREE.Color(k, k, k));
    }

    // Haze: a ring of soft lighter-teal puffs just behind the planet's edge, turned to face the
    // camera each frame, so it reads as a halo round the silhouette (and hides below the ground in play).
    const hazeMat = (this.hazeMat = new THREE.MeshBasicMaterial({ color: 0x8fd0c6, transparent: true, opacity: 0.5, depthWrite: false }));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const r = R + rng.range(2, 12);
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(6, 11), 1), hazeMat);
      puff.position.set(Math.cos(a) * r, Math.sin(a) * r, -R * 0.9);
      puff.scale.set(1, 0.55, 0.2);
      puff.rotation.z = a;
      this.haze.add(puff);
    }
    for (const m of [this.rocks, this.rockHull, this.specks]) {
      m.frustumCulled = false;
      m.raycast = () => {};
    }
    this.haze.traverse((o) => (o.raycast = () => {}));
    scene.add(this.rocks, this.rockHull, this.specks, this.haze);
  }

  private drifter(rng: Rng, radius: number, scale: number): Drifter {
    const axis = new THREE.Vector3(rng.range(-0.4, 0.4), 1, rng.range(-0.4, 0.4)).normalize();
    const base = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
    if (base.lengthSq() < 1e-4) base.set(1, 0, 0);
    base.setLength(radius);
    return {
      axis,
      base,
      speed: rng.range(0.004, 0.015) * (rng.chance(0.5) ? 1 : -1),
      angle: rng.range(0, Math.PI * 2),
      spin: new THREE.Vector3(rng.range(-0.4, 0.4), rng.range(-0.4, 0.4), rng.range(-0.4, 0.4)),
      scale,
    };
  }

  /** Colours for the time of day: blue-teal by day, sunset orange in the evening, deep blue at night. */
  setTones(rock: THREE.Color, speck: THREE.Color, haze: THREE.Color): void {
    (this.rocks.material as THREE.MeshBasicMaterial).color.copy(rock);
    (this.specks.material as THREE.MeshBasicMaterial).color.copy(speck);
    this.hazeMat.color.copy(haze);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.t += dt;
    this.haze.lookAt(camera.position);
    const place = (mesh: THREE.InstancedMesh, list: Drifter[]) => {
      list.forEach((d, i) => {
        d.angle += d.speed * dt;
        _o.position.copy(d.base).applyAxisAngle(d.axis, d.angle);
        _o.rotation.set(d.spin.x * this.t, d.spin.y * this.t, d.spin.z * this.t);
        _o.scale.setScalar(d.scale);
        _o.updateMatrix();
        mesh.setMatrixAt(i, _o.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(this.rocks, this.drifters);
    place(this.specks, this.speckDrift);
  }
}
