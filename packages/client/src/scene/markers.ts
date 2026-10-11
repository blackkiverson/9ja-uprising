import * as THREE from 'three';

const ACCENT = 0xe3c24a;
const INK = 0x283130;

/** Flat downward chevron (a "V" made of two bars), pointing at -y. */
function chevron(size: number, thick: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-size, size * 0.9);
  s.lineTo(0, 0);
  s.lineTo(size, size * 0.9);
  s.lineTo(size, size * 0.9 - thick);
  s.lineTo(0, -thick * 1.2);
  s.lineTo(-size, size * 0.9 - thick);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** Marker over the player's head: a small bobbing chevron, visible through anything in front. */
export function headMarker(): THREE.Group {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(chevron(0.32, 0.16), new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, side: THREE.DoubleSide }));
  const edge = new THREE.Mesh(chevron(0.4, 0.3), new THREE.MeshBasicMaterial({ color: INK, depthTest: false, side: THREE.DoubleSide }));
  edge.position.set(0, -0.04, -0.01);
  fill.renderOrder = 21;
  edge.renderOrder = 20;
  g.add(edge, fill);
  g.userData.base = 3.45;
  return g;
}

/**
 * League-style move marker: four chevrons converge on the tapped spot while a ring shrinks and fades.
 * Lies flat on the ground at the target.
 */
export class MoveMarker {
  readonly root = new THREE.Group();
  private arrows: THREE.Mesh[] = [];
  private ring: THREE.Mesh;
  private mats: THREE.MeshBasicMaterial[] = [];
  private t = 1;
  private static DURATION = 0.55;

  constructor(scene: THREE.Scene) {
    const mat = () => {
      const m = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      this.mats.push(m);
      return m;
    };
    const geo = chevron(0.45, 0.18).rotateX(-Math.PI / 2); // lie flat, tip towards +z
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const a = new THREE.Mesh(geo, mat());
      a.rotation.y = Math.PI; // tip points at the centre
      pivot.add(a);
      this.root.add(pivot);
      this.arrows.push(a);
    }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), mat());
    this.root.add(this.ring);
    this.root.visible = false;
    this.root.renderOrder = 6;
    this.root.traverse((o) => (o.renderOrder = 6));
    scene.add(this.root);
  }

  show(point: THREE.Vector3): void {
    const up = point.clone().normalize();
    this.root.position.copy(point).addScaledVector(up, 0.06);
    this.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    this.t = 0;
    this.root.visible = true;
  }

  update(dt: number): void {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / MoveMarker.DURATION);
    const e = 1 - (1 - this.t) ** 3; // ease out
    for (const a of this.arrows) a.position.z = THREE.MathUtils.lerp(1.8, 0.35, e);
    this.ring.scale.setScalar(THREE.MathUtils.lerp(1.4, 0.4, e));
    const alpha = this.t < 0.7 ? 1 : 1 - (this.t - 0.7) / 0.3;
    for (const m of this.mats) m.opacity = alpha;
    if (this.t >= 1) this.root.visible = false;
  }
}
