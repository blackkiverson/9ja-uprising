import * as THREE from 'three';
import { northAt } from './sphere';

// League-style camera adapted to a planet: angled down ~55 degrees, follows the player over the
// curve. "Screen up" (forward) is carried along as you walk, so the view never spins.
const PITCH = THREE.MathUtils.degToRad(55);

/** Fixed play distance: close enough to feel the curve. The player cannot zoom. */
export const PLAY_DISTANCE = 40;
/** The character can wander this far from screen centre before the camera follows. */
const DEADZONE = 2;
const FOLLOW_RATE = 5;
const RECENTRE_RATE = 1.2;

export function createCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.5, 800);
}

export class CameraRig {
  /** Tangent direction that points up the screen. */
  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  /** Point on the ground the camera looks at; trails the player so they visibly move on screen. */
  readonly focus = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    start: THREE.Vector3,
  ) {
    northAt(start, this.forward);
    this.update(start, 1, true);
  }

  /** Where the camera sits for the current focus (also the end point of the intro flight). */
  desiredPosition(out = new THREE.Vector3()): THREE.Vector3 {
    // Portrait phones see less horizontally, so pull back further.
    const d = PLAY_DISTANCE * Math.max(1, Math.sqrt(1.2 / this.camera.aspect));
    return out
      .copy(this.focus)
      .addScaledVector(this.up, Math.sin(PITCH) * d)
      .addScaledVector(this.forward, -Math.cos(PITCH) * d);
  }

  /** Re-centre on a point anywhere on the planet, with screen-up pointing north there. */
  reset(target: THREE.Vector3): void {
    northAt(target, this.forward);
    this.update(target, 1, true);
  }

  update(target: THREE.Vector3, dt: number, snap = false): void {
    if (snap) this.focus.copy(target);
    else {
      // Dead zone + lag: the camera only chases once the player leaves the middle,
      // and drifts back to centre when they stop.
      const gap = target.clone().sub(this.focus);
      const dist = gap.length();
      if (dist > DEADZONE) this.focus.addScaledVector(gap, ((dist - DEADZONE) / dist) * (1 - Math.exp(-FOLLOW_RATE * dt)));
      this.focus.lerp(target, 1 - Math.exp(-RECENTRE_RATE * dt));
      this.focus.setLength(target.length());
    }
    this.up.copy(this.focus).normalize();
    // Parallel transport: keep forward tangent to the ground under the camera.
    this.forward.addScaledVector(this.up, -this.forward.dot(this.up)).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    this.desiredPosition(this.camera.position);
    this.camera.up.copy(this.up);
    this.camera.lookAt(this.focus);
  }
}

/**
 * Title view: the whole planet slowly turning, then a flight down to the player on Begin.
 * Returns true while it owns the camera.
 */
export class Intro {
  private phase: 'orbit' | 'flying' | 'leaving' | 'done' = 'orbit';
  private angle = 0.6;
  private t = 0;
  private from = new THREE.Vector3();
  private fromUp = new THREE.Vector3();

  get active(): boolean {
    return this.phase !== 'done';
  }

  begin(camera: THREE.Camera): void {
    // Also allowed mid fly-out, so tapping Begin straight after Exit isn't ignored.
    if (this.phase !== 'orbit' && this.phase !== 'leaving') return;
    this.phase = 'flying';
    this.t = 0;
    this.from.copy(camera.position);
    this.fromUp.copy(camera.up);
  }

  skip(): void {
    this.phase = 'done';
  }

  /** Back to the title: fly from the play camera out to the orbiting view. */
  exit(camera: THREE.Camera): void {
    if (this.phase !== 'done') return;
    this.phase = 'leaving';
    this.t = 0;
    this.from.copy(camera.position);
    this.fromUp.copy(camera.up);
    // Pick up the orbit from the side of the planet we're on, so the fly-out doesn't swing round.
    this.angle = Math.atan2(camera.position.x, camera.position.z);
  }

  private orbitPosition(camera: THREE.PerspectiveCamera, out = new THREE.Vector3()): THREE.Vector3 {
    const fit = 78 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
    return out.set(Math.sin(this.angle), 0.35, Math.cos(this.angle)).setLength(fit);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, rig: CameraRig): void {
    if (this.phase === 'orbit') {
      this.angle += 0.12 * dt;
      // Far enough that the planet and its clouds fit on any screen shape.
      this.orbitPosition(camera, camera.position);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      return;
    }
    if (this.phase === 'leaving') {
      this.t = Math.min(1, this.t + dt / 2.2);
      const e = this.t * this.t * (3 - 2 * this.t);
      const to = this.orbitPosition(camera);
      const q = new THREE.Quaternion().setFromUnitVectors(this.from.clone().normalize(), to.clone().normalize());
      const dir = this.from.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(q, e));
      camera.position.copy(dir).setLength(THREE.MathUtils.lerp(this.from.length(), to.length(), e));
      camera.up.copy(this.fromUp).lerp(new THREE.Vector3(0, 1, 0), e).normalize();
      camera.lookAt(rig.focus.clone().lerp(new THREE.Vector3(), e));
      if (this.t >= 1) this.phase = 'orbit';
      return;
    }
    if (this.phase !== 'flying') return;
    this.t = Math.min(1, this.t + dt / 2.8);
    const e = this.t * this.t * (3 - 2 * this.t);
    const to = rig.desiredPosition();
    // Swing round the planet (direction slerp) while closing the distance, so we never cut through it.
    const q = new THREE.Quaternion().setFromUnitVectors(this.from.clone().normalize(), to.clone().normalize());
    const dir = this.from.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(q, e));
    camera.position.copy(dir).setLength(THREE.MathUtils.lerp(this.from.length(), to.length(), e));
    camera.up.copy(this.fromUp).lerp(rig.focus.clone().normalize(), e).normalize();
    camera.lookAt(new THREE.Vector3().lerp(rig.focus, e));
    if (this.t >= 1) this.phase = 'done';
  }
}

// --- Fading buildings that hide the player ---
const _a = new THREE.Vector3();

/** Segment vs axis-aligned box (slab test). */
function segmentHitsBox(a: THREE.Vector3, b: THREE.Vector3, box: THREE.Box3): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-9) {
      if (a[axis] < box.min[axis] || a[axis] > box.max[axis]) return false;
      continue;
    }
    let near = (box.min[axis] - a[axis]) / d;
    let far = (box.max[axis] - a[axis]) / d;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 > t1) return false;
  }
  return true;
}

/** Points on the player's silhouette: feet, head, and both sides at chest height. */
const SILHOUETTE = [[0, 0.15], [0, 1.95], [-0.4, 1.1], [0.4, 1.1], [0, 1.1]] as const;
const _t = new THREE.Vector3();
const _side = new THREE.Vector3();

/**
 * Fades a building only when it hides the whole player: every silhouette point must be behind it.
 * A building that clips an edge of you, or hides nearby street, stays solid. Tested in each
 * building's own flat frame, which is exact for a bent box.
 */
export function fadeOccluders(camera: THREE.Camera, target: THREE.Vector3 | null, occluders: THREE.Mesh[], dt: number): void {
  const k = 1 - Math.exp(-14 * dt);
  // No target (player hidden indoors): everything goes back to solid.
  if (!target) {
    for (const obj of occluders) fadeTo(obj, 1, k);
    return;
  }
  const up = target.clone().normalize();
  // Screen-sideways, flattened onto the ground at the player.
  _side.setFromMatrixColumn(camera.matrixWorld, 0);
  _side.addScaledVector(up, -_side.dot(up)).normalize();
  const points = SILHOUETTE.map(([x, y]) => target.clone().addScaledVector(_side, x).addScaledVector(up, y));
  for (const obj of occluders) {
    const { frame, bounds } = obj.userData as { frame: import('./sphere').Frame; bounds: THREE.Box3 };
    let hit = false;
    if (frame.c.distanceToSquared(target) < 36 * 36) {
      frame.toLocal(camera.position, _a);
      hit = points.every((p) => segmentHitsBox(_a, frame.toLocal(p, _t), bounds));
    }
    fadeTo(obj, hit ? 0.12 : 1, k);
  }
}

function fadeTo(obj: THREE.Mesh, goal: number, k: number): void {
  const mat = obj.material as THREE.MeshToonMaterial;
  if (mat.opacity === goal) return;
  mat.opacity += (goal - mat.opacity) * k;
  if (Math.abs(mat.opacity - goal) < 0.01) mat.opacity = goal;
  const transparent = mat.opacity < 1;
  // The opaque shader forces alpha to 1, so switching needs a recompile (cached after the first).
  if (transparent !== mat.transparent) {
    mat.transparent = transparent;
    mat.needsUpdate = true;
  }
  // A see-through building shouldn't hide what's behind it in the depth buffer either.
  mat.depthWrite = mat.opacity > 0.9;
  // Hide the outline hull while faded, otherwise it shows as a dark slab.
  for (const child of obj.children) child.visible = mat.opacity > 0.9;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Time-lapse camera: pull out to the whole planet, spin it fast through the hours being skipped,
 * then dive back in on wherever the player ends up. Driven by elapsed time over a fixed total,
 * so it lands exactly when the time-lapse ends.
 */
export class LapseCam {
  active = false;
  private from = new THREE.Vector3();
  private fromUp = new THREE.Vector3();
  private fromFocus = new THREE.Vector3();
  private startAngle = 0;
  private landed = false;
  private static OUT = 1.3;
  private static IN = 1.6;

  start(camera: THREE.Camera, rig: CameraRig): void {
    this.active = true;
    this.landed = false;
    this.from.copy(camera.position);
    this.fromUp.copy(camera.up);
    this.fromFocus.copy(rig.focus);
    this.startAngle = Math.atan2(camera.position.x, camera.position.z);
  }

  /** Orbit point at an angle round the planet, far enough to fit it on screen. */
  private orbit(camera: THREE.PerspectiveCamera, angle: number, out = new THREE.Vector3()): THREE.Vector3 {
    const fit = 72 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
    return out.set(Math.sin(angle), 0.3, Math.cos(angle)).setLength(fit);
  }

  /** elapsed/total in seconds; dest: where the player is now (the dive's target). */
  update(elapsed: number, total: number, camera: THREE.PerspectiveCamera, rig: CameraRig, dest: THREE.Vector3): void {
    if (!this.active) return;
    const out = LapseCam.OUT;
    const dive = LapseCam.IN;
    const spinTime = Math.max(0.5, total - out - dive);
    // The spin ends facing the destination, after at least one full fast turn.
    let endAngle = Math.atan2(dest.x, dest.z);
    while (endAngle < this.startAngle + Math.PI * 2) endAngle += Math.PI * 2;

    if (elapsed < out) {
      const e = smooth(elapsed / out);
      const to = this.orbit(camera, this.startAngle);
      const q = new THREE.Quaternion().setFromUnitVectors(this.from.clone().normalize(), to.clone().normalize());
      const dir = this.from.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(q, e));
      camera.position.copy(dir).setLength(THREE.MathUtils.lerp(this.from.length(), to.length(), e));
      camera.up.copy(this.fromUp).lerp(Y, e).normalize();
      camera.lookAt(this.fromFocus.clone().lerp(new THREE.Vector3(), e));
      return;
    }
    if (elapsed < out + spinTime) {
      const e = smooth((elapsed - out) / spinTime);
      this.orbit(camera, THREE.MathUtils.lerp(this.startAngle, endAngle, e), camera.position);
      camera.up.copy(Y);
      camera.lookAt(0, 0, 0);
      return;
    }
    // Dive: line the rig up on the destination, then fly from the orbit down to its view.
    if (!this.landed) {
      rig.reset(dest);
      this.landed = true;
    } else rig.update(dest, 0, true);
    const e = smooth(Math.min(1, (elapsed - out - spinTime) / dive));
    const fromPos = this.orbit(camera, endAngle);
    const to = rig.desiredPosition();
    const q = new THREE.Quaternion().setFromUnitVectors(fromPos.clone().normalize(), to.clone().normalize());
    const dir = fromPos.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(q, e));
    camera.position.copy(dir).setLength(THREE.MathUtils.lerp(fromPos.length(), to.length(), e));
    camera.up.copy(Y).lerp(rig.focus.clone().normalize(), e).normalize();
    camera.lookAt(new THREE.Vector3().lerp(rig.focus, e));
    if (elapsed >= total) this.active = false;
  }
}
