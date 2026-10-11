import * as THREE from 'three';
import { toonMesh } from './toon';

const SPEED = 6; // world units per second

export class PlayerAvatar {
  readonly root = new THREE.Group();
  private target: THREE.Vector3 | null = null;

  constructor() {
    const body = toonMesh(new THREE.CapsuleGeometry(0.45, 1, 4, 8), 0x2e7d5b);
    body.position.y = 0.95;
    const head = toonMesh(new THREE.SphereGeometry(0.38, 12, 10), 0x6b4226);
    head.position.y = 1.95;
    const afro = toonMesh(new THREE.SphereGeometry(0.42, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x1b1410);
    afro.position.y = 2.02;
    this.root.add(body, head, afro);
  }

  moveTo(point: THREE.Vector3): void {
    this.target = point.clone().setY(0);
  }

  teleport(point: THREE.Vector3): void {
    this.root.position.copy(point).setY(0);
    this.target = null;
  }

  /** Straight-line movement for now; navmesh + three-mesh-bvh collisions come next. */
  update(dt: number): void {
    if (!this.target) return;
    const toTarget = this.target.clone().sub(this.root.position);
    const dist = toTarget.length();
    if (dist < 0.05) {
      this.target = null;
      return;
    }
    const step = Math.min(dist, SPEED * dt);
    toTarget.normalize();
    this.root.position.addScaledVector(toTarget, step);
    this.root.rotation.y = Math.atan2(toTarget.x, toTarget.z);
  }
}
