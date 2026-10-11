import * as THREE from 'three';
import type { Collisions } from './collision';
import { R } from './sphere';
import { headMarker } from './markers';
import { toonMesh } from './toon';

const SPEED = 6; // metres per second
const JUMP_SPEED = 6.5;
const GRAVITY = 20;

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();

/** The player walks on the planet surface; "up" is always away from the planet centre. */
export class PlayerAvatar {
  readonly root = new THREE.Group();
  /** Ground position on the surface. */
  private pos = new THREE.Vector3(0, 0, R);
  private facing = new THREE.Vector3(0, 1, 0);
  private height = 0;
  private vy = 0;
  private target: THREE.Vector3 | null = null;
  /** Remaining waypoints after the current target (from the route-finder). */
  private route: THREE.Vector3[] = [];
  private stuckTime = 0;
  private shadow: THREE.Mesh;
  private marker = headMarker();
  private clock = 0;

  constructor() {
    const body = toonMesh(new THREE.CapsuleGeometry(0.45, 1, 4, 8), 0x2e7d5b);
    body.position.y = 0.95;
    const head = toonMesh(new THREE.SphereGeometry(0.38, 12, 10), 0x6b4226);
    head.position.y = 1.95;
    const afro = toonMesh(new THREE.SphereGeometry(0.42, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x1b1410);
    afro.position.y = 2.02;
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x1c2b1a, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.root.add(body, head, afro, this.shadow);

    this.root.add(this.marker);

    // X-ray silhouette: drawn only where something (tree, pole, cloud) is in front of the player.
    const ghost = new THREE.MeshBasicMaterial({
      color: 0x283130,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
    });
    for (const part of [body, head, afro]) {
      const g = new THREE.Mesh(part.geometry, ghost);
      g.position.copy(part.position);
      g.renderOrder = 10;
      g.raycast = () => {};
      this.root.add(g);
    }
  }

  /** Position on the ground, ignoring jump height. Use for camera, doors and interactions. */
  get ground(): THREE.Vector3 {
    return this.pos.clone();
  }

  moveTo(point: THREE.Vector3): void {
    this.followPath([point]);
  }

  /** Walk a list of waypoints in order (a route round buildings). */
  followPath(points: THREE.Vector3[]): void {
    this.route = points.map((p) => p.clone().setLength(R));
    this.target = this.route.shift() ?? null;
    this.stuckTime = 0;
  }

  teleport(point: THREE.Vector3): void {
    // Keep any terrain height the caller passed; never go below the base sphere.
    this.pos.copy(point).setLength(Math.max(R, point.length()));
    this.target = null;
    this.height = 0;
    this.vy = 0;
    this.syncRoot();
  }

  /** Lets something solid that moves (a car) shove the player aside. */
  push<T>(fn: (pos: THREE.Vector3) => T): T {
    const out = fn(this.pos);
    this.syncRoot();
    return out;
  }

  /** Turn the head marker to face the camera so the chevron is always seen flat on. */
  faceMarker(camera: THREE.Camera): void {
    const local = this.root.worldToLocal(camera.position.clone());
    this.marker.rotation.y = Math.atan2(local.x, local.z);
  }

  /** Hide the head marker (e.g. on the title screen). */
  setMarkerVisible(v: boolean): void {
    this.marker.visible = v;
  }

  jump(): void {
    if (this.height <= 0) this.vy = JUMP_SPEED;
  }

  /** dir: desired walking direction in world space (tangent), or zero. Keyboard wins over click targets. */
  update(dt: number, dir: THREE.Vector3, collisions: Collisions, heightAt: (p: THREE.Vector3) => number = () => 0): void {
    const up = this.pos.clone().normalize();
    const before = this.pos.clone();
    let move: THREE.Vector3 | null = null;
    let step = 0;

    if (dir.lengthSq() > 0) {
      this.target = null;
      this.route = [];
      move = dir.clone().addScaledVector(up, -dir.dot(up)).normalize();
      step = SPEED * dt;
    } else if (this.target) {
      const to = this.target.clone().setLength(this.pos.length()).sub(this.pos);
      to.addScaledVector(up, -to.dot(up));
      const dist = to.length();
      // Intermediate waypoints only need to be passed near, not hit exactly.
      if (dist < (this.route.length ? 0.45 : 0.05)) this.target = this.route.shift() ?? null;
      else {
        move = to.normalize();
        step = Math.min(dist, SPEED * dt);
      }
    }

    if (move) {
      // Small sub-steps so a fast frame can't carry the player into (or through) a thin wall.
      const tryMove = (from: THREE.Vector3, dir: THREE.Vector3, dist: number) => {
        const p = from.clone();
        const n = Math.max(1, Math.ceil(dist / 0.15));
        for (let i = 0; i < n; i++) {
          p.addScaledVector(dir, dist / n).setLength(R);
          collisions.resolve(p);
        }
        return p;
      };
      let next = tryMove(this.pos, move, step);
      // Click-to-move blocked by a wall: try angled directions and take the one that makes the
      // most progress towards the target, so the player slides round corners instead of stopping.
      if (this.target && next.distanceTo(this.pos) < step * 0.5) {
        let best = next;
        let bestLeft = next.distanceTo(this.target);
        for (const a of [0.6, -0.6, 1.2, -1.2, 1.57, -1.57]) {
          const cand = tryMove(this.pos, move.clone().applyAxisAngle(up, a), step);
          const left = cand.distanceTo(this.target);
          if (cand.distanceTo(this.pos) > step * 0.4 && left < bestLeft - 0.01) {
            best = cand;
            bestLeft = left;
          }
        }
        next = best;
      }
      this.pos.copy(next);
      // Walk over hills: stand on the raised ground.
      this.pos.setLength(R + heightAt(this.pos));
      const moved = this.pos.clone().sub(before);
      if (moved.lengthSq() > 1e-6) this.facing.copy(moved);
      // Only give up on a click target if nothing at all gets us closer for a while.
      if (this.target && moved.length() < step * 0.2) {
        this.stuckTime += dt;
        if (this.stuckTime > 0.6) {
          this.target = null;
          this.route = [];
        }
      } else this.stuckTime = 0;
    }

    // Bob the head marker gently and keep it facing the camera side (it billboards in syncRoot's frame).
    this.clock += dt;
    this.marker.position.y = this.marker.userData.base + Math.sin(this.clock * 3.2) * 0.12;

    if (this.vy !== 0 || this.height > 0) {
      this.vy -= GRAVITY * dt;
      this.height = Math.max(0, this.height + this.vy * dt);
      if (this.height === 0) this.vy = 0;
    }
    this.syncRoot();
  }

  /** Stand upright on the curve, facing the walking direction; shadow stays on the ground. */
  private syncRoot(): void {
    const up = this.pos.clone().normalize();
    this.facing.addScaledVector(up, -this.facing.dot(up));
    if (this.facing.lengthSq() < 1e-8) this.facing.set(1, 0, 0).addScaledVector(up, -up.x);
    this.facing.normalize();
    _x.crossVectors(up, this.facing);
    _m.makeBasis(_x, up, this.facing);
    this.root.quaternion.setFromRotationMatrix(_m);
    this.root.position.copy(this.pos).addScaledVector(up, this.height);
    this.shadow.position.y = 0.05 - this.height;
    this.shadow.scale.setScalar(1 - Math.min(0.5, this.height * 0.3));
  }
}
