import * as THREE from 'three';
import type { Rng } from './rng';
import type { Frame } from './sphere';
import { toonMaterial } from './toon';

/*
 * Pigeons on rooftops: they sit and peck, shuffle about, and now and then the flock lifts off and
 * lands on another roof. Walk under them and they scatter. They roost at night. All instanced:
 * body, head and two wings, four draw calls for every pigeon in town.
 */

interface Roof {
  /** Places a pigeon can stand: the roof's top surface (and anything on it, like a tank). */
  spots: THREE.Vector3[];
}

type Mode = 'sit' | 'walk' | 'fly';

interface Pigeon {
  roof: number;
  p: THREE.Vector3;
  face: THREE.Vector3;
  mode: Mode;
  timer: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Flight or walk progress 0..1, and how long the whole move takes. */
  s: number;
  dur: number;
  peck: number;
  phase: number;
}

const COLOURS = [0x8a9099, 0x8a9099, 0x6f757e, 0x9aa0a8, 0xd9dcd6, 0x7a6a5e];
/** Bigger than life so they read from the camera. */
const SIZE = 1.5;
const SPOOK = 6;
const ROOF_MAX = 9;

const _up = new THREE.Vector3();
const _x = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();
const _s = new THREE.Matrix4().makeScale(SIZE, SIZE, SIZE);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

export class Pigeons {
  private roofs: Roof[] = [];
  private birds: Pigeon[] = [];
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private left: THREE.InstancedMesh;
  private right: THREE.InstancedMesh;
  private t = 0;

  constructor(
    scene: THREE.Scene,
    private rng: Rng,
    buildings: THREE.Mesh[],
    /** Roofs that always get a flock: the places the player spends time in (office, clinic). */
    always: THREE.Mesh[] = [],
    roofCount = 14,
  ) {
    const picks = buildings.filter((b) => !always.includes(b));
    for (let i = picks.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [picks[i], picks[j]] = [picks[j]!, picks[i]!];
    }
    picks.unshift(...always);
    for (const b of picks) {
      if (this.roofs.length >= roofCount) break;
      const spots = roofSpots(b, rng);
      if (spots.length < 6) continue;
      const roof = this.roofs.push({ spots }) - 1;
      for (let i = 0, n = rng.int(3, 6); i < n; i++) {
        const p = rng.pick(spots).clone();
        this.birds.push({
          roof,
          p,
          face: tangentAt(p, rng.range(0, Math.PI * 2)),
          mode: 'sit',
          timer: rng.range(0, 6),
          from: p.clone(),
          to: p.clone(),
          s: 0,
          dur: 1,
          peck: 0,
          phase: rng.range(0, 6),
        });
      }
    }

    const n = Math.max(1, this.birds.length);
    // Plump body with a tail, a small head; wings are flat triangles hinged at the shoulder.
    const bodyGeo = new THREE.SphereGeometry(0.11, 8, 6).scale(0.85, 0.8, 1.35).translate(0, 0.13, 0);
    const headGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.08, 0, 0, -0.08, 0.3, 0, -0.04], 3));
    wing.computeVertexNormals();
    const mirrored = wing.clone().scale(-1, 1, 1);
    const wingMat = toonMaterial(0x7a8089);
    wingMat.side = THREE.DoubleSide;
    this.body = new THREE.InstancedMesh(bodyGeo, toonMaterial(0xffffff), n);
    this.head = new THREE.InstancedMesh(headGeo, toonMaterial(0x5c6470), n);
    this.left = new THREE.InstancedMesh(mirrored, wingMat, n);
    this.right = new THREE.InstancedMesh(wing, wingMat, n);
    this.birds.forEach((b, i) => this.body.setColorAt(i, new THREE.Color(rng.pick(COLOURS))));
    for (const m of [this.body, this.head, this.left, this.right]) {
      m.count = this.birds.length;
      m.frustumCulled = false;
      m.raycast = () => {};
      scene.add(m);
    }
  }

  /** player: where the player is (null on the title); night 0..1 (they roost after dark). */
  update(dt: number, player: THREE.Vector3 | null, night: number): void {
    this.t += dt;
    const r = this.rng;
    const awake = night < 0.5;
    // Walk under a roof and the whole flock goes.
    if (player && awake) {
      for (const [i, roof] of this.roofs.entries()) {
        if (roof.spots[0]!.distanceTo(player) > SPOOK + 8) continue;
        const near = this.birds.some((b) => b.roof === i && b.mode !== 'fly' && horizontal(b.p, player) < SPOOK);
        if (near) this.takeOff(i);
      }
    }
    this.birds.forEach((b, i) => {
      b.timer -= dt;
      if (b.mode === 'sit') {
        b.peck = Math.max(0, b.peck - dt);
        if (b.timer <= 0) {
          b.timer = r.range(2, 7);
          const roll = r.next();
          if (!awake) b.peck = 0;
          else if (roll < 0.04) this.takeOff(b.roof);
          else if (roll < 0.55) this.walk(b);
          else if (roll < 0.85) b.peck = 0.5;
          else b.face = tangentAt(b.p, r.range(0, Math.PI * 2));
        }
      } else {
        b.s = Math.min(1, b.s + dt / b.dur);
        // A flock's take-off is staggered: below zero, still waiting its turn.
        const s = Math.max(0, b.s);
        if (b.mode === 'walk') b.p.lerpVectors(b.from, b.to, s);
        else {
          // Up, over and down: a hop between roofs arcs higher the further it goes.
          const e = s * s * (3 - 2 * s);
          b.p.lerpVectors(b.from, b.to, e);
          const len = THREE.MathUtils.lerp(b.from.length(), b.to.length(), e);
          b.p.setLength(len + Math.sin(Math.PI * s) * (2.5 + b.from.distanceTo(b.to) * 0.15));
        }
        if (b.s >= 1) {
          b.p.copy(b.to);
          b.mode = 'sit';
          b.timer = r.range(1.5, 5);
        }
      }
      this.draw(b, i);
    });
    for (const m of [this.body, this.head, this.left, this.right]) m.instanceMatrix.needsUpdate = true;
  }

  /** Live positions of pigeons near a point, for the camera to visit. */
  subjects(near: THREE.Vector3, r: number): THREE.Vector3[] {
    return this.birds.filter((b) => b.p.distanceTo(near) < r).map((b) => b.p);
  }

  private walk(b: Pigeon): void {
    const spots = this.roofs[b.roof]!.spots;
    const options = spots.filter((s) => s.distanceTo(b.p) < 2.5 && s.distanceTo(b.p) > 0.4 && Math.abs(s.length() - b.p.length()) < 0.15);
    if (!options.length) return;
    b.from.copy(b.p);
    b.to.copy(this.rng.pick(options));
    b.face = _f.copy(b.to).sub(b.from).normalize().clone();
    b.mode = 'walk';
    b.s = 0;
    b.dur = b.from.distanceTo(b.to) / 0.5;
  }

  /** The whole flock on a roof lifts off together for another roof (or circles back to this one). */
  private takeOff(roof: number): void {
    const r = this.rng;
    const here = this.roofs[roof]!.spots[0]!;
    const flock = this.birds.filter((b) => b.roof === roof && b.mode !== 'fly').length;
    // Somewhere close with room for them all: no roof turns into a pigeon pile.
    const nearby = this.roofs
      .map((_, i) => i)
      .filter((i) => i !== roof && this.roofs[i]!.spots[0]!.distanceTo(here) < 45 && this.birds.filter((b) => b.roof === i).length + flock <= ROOF_MAX);
    const dest = nearby.length && r.chance(0.8) ? r.pick(nearby) : roof;
    for (const b of this.birds) {
      if (b.roof !== roof || b.mode === 'fly') continue;
      b.roof = dest;
      b.from.copy(b.p);
      b.to.copy(r.pick(this.roofs[dest]!.spots));
      b.face = _f.copy(b.to).sub(b.from).normalize().clone();
      b.mode = 'fly';
      b.s = -r.range(0, 0.25); // not all at once
      b.dur = 1.2 + b.from.distanceTo(b.to) / 7;
    }
  }

  private draw(b: Pigeon, i: number): void {
    _up.copy(b.p).normalize();
    _f.copy(b.face).addScaledVector(_up, -b.face.dot(_up));
    if (_f.lengthSq() < 1e-6) _f.set(1, 0, 0).addScaledVector(_up, -_up.x);
    _f.normalize();
    _x.crossVectors(_up, _f).normalize();
    _m.makeBasis(_x, _up, _f).setPosition(b.p).multiply(_s);
    const flying = b.mode === 'fly' && b.s > 0;
    // Bank a little and pitch up in the air.
    if (flying) _m.multiply(_l.makeRotationX(-0.25));
    this.body.setMatrixAt(i, _m);
    // Head: bobs with each step, dips to peck.
    const walking = b.mode === 'walk';
    const bob = walking ? Math.sin(this.t * 14 + b.phase) * 0.03 : 0;
    const peck = b.peck > 0 ? Math.sin((b.peck / 0.5) * Math.PI) : 0;
    _p.set(0, 0.26 - peck * 0.14, 0.13 + bob + peck * 0.06);
    this.head.setMatrixAt(i, _l.copy(_m).multiply(new THREE.Matrix4().makeTranslation(_p.x, _p.y, _p.z)));
    if (flying) {
      const flap = Math.sin(this.t * 22 + b.phase) * 0.9;
      this.right.setMatrixAt(i, _l.copy(_m).multiply(new THREE.Matrix4().makeRotationZ(-flap).setPosition(0.06, 0.17, 0)));
      this.left.setMatrixAt(i, _l.copy(_m).multiply(new THREE.Matrix4().makeRotationZ(flap).setPosition(-0.06, 0.17, 0)));
    } else {
      this.right.setMatrixAt(i, HIDE);
      this.left.setMatrixAt(i, HIDE);
    }
  }
}

function horizontal(a: THREE.Vector3, b: THREE.Vector3): number {
  _up.copy(a).normalize();
  _p.copy(b).sub(a);
  return _p.addScaledVector(_up, -_p.dot(_up)).length();
}

function tangentAt(p: THREE.Vector3, angle: number): THREE.Vector3 {
  const up = p.clone().normalize();
  const t = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
  return t.applyAxisAngle(up, angle);
}

/** Drop rays onto a building's roof (and whatever sits on it) to find flat places to stand. */
function roofSpots(b: THREE.Mesh, rng: Rng): THREE.Vector3[] {
  const { frame, bounds } = b.userData as { frame: Frame; bounds: THREE.Box3 };
  const meshes: THREE.Mesh[] = [];
  b.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  b.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster();
  const spots: THREE.Vector3[] = [];
  for (let k = 0; k < 24; k++) {
    const lx = rng.range(bounds.min.x + 0.4, bounds.max.x - 0.4);
    const lz = rng.range(bounds.min.z + 0.4, bounds.max.z - 0.4);
    const top = frame.toWorld(lx, bounds.max.y + 3, lz);
    ray.set(top, top.clone().normalize().negate());
    const hits: THREE.Intersection[] = [];
    // Buildings opt out of raycasts for speed; ask the mesh directly, once, here.
    for (const m of meshes) THREE.Mesh.prototype.raycast.call(m, ray, hits);
    hits.sort((a, c) => a.distance - c.distance);
    const hit = hits[0];
    if (!hit?.face) continue;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (n.dot(top.clone().normalize()) < 0.85) continue; // too steep: a pitched roof's slope
    spots.push(hit.point.clone());
  }
  return spots;
}
