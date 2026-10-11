import * as THREE from 'three';
import { R } from './sphere';
import { toonMaterial } from './toon';

export type SmokeKind = 'cook' | 'fire' | 'refuse' | 'exhaust';

interface Style {
  rate: number; // puffs per second
  color: number;
  size: [number, number]; // start and end radius
  rise: number; // metres per second
  life: number; // seconds
  alpha: number;
}

const STYLES: Record<SmokeKind, Style> = {
  cook: { rate: 6, color: 0xeef0e6, size: [0.25, 1.1], rise: 1.1, life: 3.5, alpha: 0.75 },
  fire: { rate: 5, color: 0x9a9a92, size: [0.7, 3.4], rise: 2.2, life: 7.5, alpha: 0.7 },
  refuse: { rate: 3, color: 0x8a8a80, size: [0.35, 1.7], rise: 1.3, life: 5, alpha: 0.7 },
  exhaust: { rate: 5, color: 0x4a4a46, size: [0.18, 0.8], rise: 0.45, life: 1.6, alpha: 0.6 },
};

interface Puff {
  p: THREE.Vector3;
  up: THREE.Vector3;
  drift: THREE.Vector3;
  age: number;
  kind: SmokeKind;
}

interface Source {
  p: THREE.Vector3;
  kind: SmokeKind;
  carry: number;
}

const _o = new THREE.Object3D();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Rising smoke puffs: toon blobs that grow, drift with the wind and fade out. One instanced draw
 * call with a per-puff opacity. Sources only emit when near the camera's view.
 */
export class Smoke {
  private mesh: THREE.InstancedMesh;
  private alpha: THREE.InstancedBufferAttribute;
  private puffs: Puff[] = [];
  private sources: Source[] = [];
  private wind = new THREE.Vector3(0.6, 0, 0.35).normalize();

  constructor(
    scene: THREE.Scene,
    private max = 420,
  ) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    geo.setAttribute('aAlpha', this.alpha);
    const mat = toonMaterial(0xffffff);
    mat.transparent = true;
    mat.depthWrite = false;
    // Per-instance opacity, so each puff can fade on its own.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vAlpha;');
    };
    mat.customProgramCacheKey = () => 'smoke';
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.mesh.renderOrder = 5;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  addSource(p: THREE.Vector3, kind: SmokeKind): void {
    this.sources.push({ p: p.clone(), kind, carry: Math.random() });
  }

  private emit(p: THREE.Vector3, kind: SmokeKind): void {
    if (this.puffs.length >= this.max) this.puffs.shift();
    const up = p.clone().normalize();
    // Wind blows along the ground; strip any part of it that points away from the surface.
    const drift = this.wind.clone().addScaledVector(up, -this.wind.dot(up)).multiplyScalar(0.35 + Math.random() * 0.3);
    const jitter = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(0.3);
    this.puffs.push({ p: p.clone().add(jitter), up, drift, age: 0, kind });
  }

  /**
   * focus: player position in play (null on the title screen); exhausts: rear points of nearby
   * vehicles that smoke, from the traffic system.
   */
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3 | null, exhausts: THREE.Vector3[]): void {
    const camDir = camera.position.clone().normalize();
    const near = focus ? Math.max(48, camera.position.distanceTo(focus) * 1.2) : 0;
    const visible = (p: THREE.Vector3) => (focus ? p.distanceToSquared(focus) < near * near : p.dot(camDir) > R * 0.15);

    for (const s of this.sources) {
      if (!visible(s.p)) continue;
      s.carry += STYLES[s.kind].rate * dt;
      while (s.carry >= 1) {
        s.carry -= 1;
        this.emit(s.p, s.kind);
      }
    }
    for (const p of exhausts) if (Math.random() < STYLES.exhaust.rate * dt) this.emit(p, 'exhaust');

    let n = 0;
    this.puffs = this.puffs.filter((puff) => (puff.age += dt) < STYLES[puff.kind].life);
    for (const puff of this.puffs) {
      const st = STYLES[puff.kind];
      const t = puff.age / st.life;
      puff.p.addScaledVector(puff.up, st.rise * dt * (1 - t * 0.5)).addScaledVector(puff.drift, dt * (0.4 + t));
      const size = st.size[0] + (st.size[1] - st.size[0]) * Math.sqrt(t);
      _o.position.copy(puff.p);
      _o.quaternion.setFromUnitVectors(_up, puff.up);
      _o.scale.set(size, size * 0.8, size);
      _o.updateMatrix();
      this.mesh.setMatrixAt(n, _o.matrix);
      // Fade in quickly, thin out slowly, and lighten as it rises.
      const c = new THREE.Color(st.color).lerp(new THREE.Color(0xdfe6df), t * 0.6);
      this.mesh.setColorAt(n, c);
      this.alpha.setX(n, st.alpha * Math.min(1, t * 6) * (1 - t) ** 1.3);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
