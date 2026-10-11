import * as THREE from 'three';
import { Kit, box, cyl } from './kit';
import { danfoKit, kekeKit } from './kits';
import type { RoadEdge, RoadNetwork } from './roads';
import type { Rng } from './rng';
import { R } from './sphere';
import { glowMaterial, poolGeometry } from './nightlights';
import { hullGeometry, outlineMaterial, toonMaterial } from './toon';

type VehicleType = 'car' | 'danfo' | 'keke';

interface Agent {
  edge: RoadEdge;
  s: number;
  /** +1 travels from node a to node b, -1 the other way. */
  dir: 1 | -1;
  speed: number;
}

interface Vehicle extends Agent {
  type: VehicleType;
  index: number; // instance index within its type
  maxSpeed: number;
  length: number;
  /** Last position, for keeping the player out and for visibility. */
  pos: THREE.Vector3;
  color: number;
  /** Direction of travel (for exhaust). */
  fwd: THREE.Vector3;
  /** Old and smoky: puffs exhaust. */
  smoky: boolean;
  /** Drawn this frame. */
  visible: boolean;
  /** Working headlights/tail lights, left and right (plenty of drivers run with one, or none). */
  lights: [boolean, boolean];
}

interface Walker extends Agent {
  /** Which side of the street they walk on, relative to their direction. */
  side: 1 | -1;
  idle: number;
  phase: number;
  load: boolean;
  look: Look;
  /** Stays out after dark if above the night's cut (lower means home earlier). */
  owl: number;
}

interface Look {
  body: number;
  head: number;
  hat: number;
  load: number;
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _o = new THREE.Object3D();
const _l = new THREE.Matrix4();
const _t = new THREE.Matrix4();

/** Where each vehicle type's lamps sit (local x offsets, height, front/back z). */
const LIGHTS: Record<VehicleType, { front: number[]; fy: number; fz: number; rear: number[]; ry: number; rz: number }> = {
  car: { front: [-0.6, 0.6], fy: 0.6, fz: 2.04, rear: [-0.6, 0.6], ry: 0.7, rz: -2.03 },
  danfo: { front: [-0.75, 0.75], fy: 0.95, fz: 2.43, rear: [-0.8, 0.8], ry: 1, rz: -2.43 },
  keke: { front: [0], fy: 1, fz: 1.12, rear: [-0.5, 0.5], ry: 0.9, rz: -1.12 },
};

function carKit(): Kit {
  const k = new Kit();
  k.add(box(1.8, 0.7, 4), 0xffffff, [0, 0.62, 0]);
  k.add(box(1.6, 0.62, 2.1), 0xffffff, [0, 1.25, -0.25]);
  k.add(box(1.64, 0.4, 1.9), 0x3e4c52, [0, 1.27, -0.25]);
  k.add(box(1.4, 0.36, 0.05), 0x3e4c52, [0, 1.2, 0.82]);
  k.add(box(1.6, 0.14, 0.06), 0xe9e4da, [0, 0.55, 2.02]);
  for (const [x, z] of [[-0.85, -1.3], [0.85, -1.3], [-0.85, 1.3], [0.85, 1.3]] as const) {
    k.add(cyl(0.34, 0.34, 0.26, 10), 0x1d1d1d, [x, 0.34, z], { rot: [0, 0, Math.PI / 2] });
  }
  return k;
}

/** Instanced set of one shape with its outline; matrices updated every frame. */
class Instances {
  readonly mesh: THREE.InstancedMesh;
  private hull: THREE.InstancedMesh | null = null;

  constructor(scene: THREE.Scene, geometry: THREE.BufferGeometry, count: number, opts: { vertexColors?: boolean; outline?: number; material?: THREE.Material } = {}) {
    const mat = opts.material ?? toonMaterial(0xffffff, { vertexColors: opts.vertexColors });
    this.mesh = new THREE.InstancedMesh(geometry, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    scene.add(this.mesh);
    if (opts.outline) {
      this.hull = new THREE.InstancedMesh(hullGeometry(geometry), outlineMaterial(opts.outline), count);
      this.hull.instanceMatrix = this.mesh.instanceMatrix;
      this.hull.frustumCulled = false;
      this.hull.raycast = () => {};
      scene.add(this.hull);
    }
  }

  set(i: number, m: THREE.Matrix4): void {
    this.mesh.setMatrixAt(i, m);
  }

  /** Only the first n instances are drawn (visible agents are packed to the front each frame). */
  draw(n: number): void {
    this.mesh.count = n;
    if (this.hull) this.hull.count = n;
  }

  color(i: number, c: THREE.ColorRepresentation): void {
    this.mesh.setColorAt(i, new THREE.Color(c));
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const CLOTHES = [0xc9584d, 0x5b8fb0, 0xd9b44a, 0x5f9e6e, 0x8e5bb5, 0xe9ecdf, 0x2f3a3a, 0xdca06a, 0x4f8f8a, 0xb5564c];
const SKIN = [0x5a3a24, 0x6b4226, 0x4a2f1f, 0x7a5236, 0x3f281b];
const CAR_PAINT = [0xe9ecdf, 0x9aa3a8, 0x2f3a3a, 0xb5564c, 0x5b8fb0, 0xd8d3c4, 0x4d7357, 0x7a6a5a];

/**
 * Ambient life on the street graph: walkers on the pavements and verges, cars, danfos and kekes
 * driving on the right. Busy streets get more traffic and crawl, so go-slows form by themselves.
 */
export class Traffic {
  private vehicles: Vehicle[] = [];
  private walkers: Walker[] = [];
  private idlers: { p: THREE.Vector3; up: THREE.Vector3; face: THREE.Vector3; phase: number; look: Look }[] = [];
  /** Off-screen agents tick slowly with simplified rules. */
  private farClock = 0;
  private static FAR_TICK = 0.4;
  /** How far from the camera's focus agents are drawn and fully simulated, in play. */
  private static NEAR = 48;
  private adj = new Map<number, { edge: RoadEdge; from: 'a' | 'b' }[]>();
  private sets: Record<VehicleType, Instances>;
  private bodies: Instances;
  private heads: Instances;
  private hats: Instances;
  private loads: Instances;
  private shadows: Instances;
  private t = 0;
  /** Touts who come out after dark, mostly round the dead street lamps. */
  private agberos: { p: THREE.Vector3; up: THREE.Vector3; face: THREE.Vector3; phase: number; look: Look; appear: number }[] = [];
  private headGlow: THREE.InstancedMesh;
  private tailGlow: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;

  constructor(
    scene: THREE.Scene,
    private roads: RoadNetwork,
    private rng: Rng,
    private busy: (e: RoadEdge) => boolean,
    hubSpots: THREE.Vector3[],
    /** Night: whether a spot is under a working lamp; where agberos gather (dark) or loiter (lit). */
    private night: { isLit: (p: THREE.Vector3) => boolean; dark: THREE.Vector3[]; lit: THREE.Vector3[] } = { isLit: () => true, dark: [], lit: [] },
    counts = { car: 26, danfo: 10, keke: 12, walkers: 90 },
  ) {
    for (const e of roads.edges) {
      for (const [node, from] of [[e.a, 'a'], [e.b, 'b']] as const) {
        if (!this.adj.has(node)) this.adj.set(node, []);
        this.adj.get(node)!.push({ edge: e, from });
      }
    }
    this.sets = {
      car: new Instances(scene, carKit().build(), counts.car, { vertexColors: true, outline: 0.04 }),
      danfo: new Instances(scene, danfoKit().build(), counts.danfo, { vertexColors: true, outline: 0.04 }),
      keke: new Instances(scene, kekeKit().build(), counts.keke, { vertexColors: true, outline: 0.035 }),
    };
    const busyEdges = roads.edges.filter(busy);
    const spawnEdge = () => (busyEdges.length && rng.chance(0.6) ? rng.pick(busyEdges) : rng.pick(roads.edges));
    for (const type of ['car', 'danfo', 'keke'] as const) {
      for (let i = 0; i < counts[type]; i++) {
        const edge = spawnEdge();
        const maxSpeed = type === 'keke' ? rng.range(4, 5.5) : type === 'danfo' ? rng.range(5, 7) : rng.range(6, 8.5);
        const v: Vehicle = { edge, s: rng.range(0, roads.length(edge)), dir: rng.chance(0.5) ? 1 : -1, speed: 0, type, index: i, maxSpeed, length: type === 'keke' ? 2.4 : type === 'danfo' ? 5 : 4.2, pos: new THREE.Vector3(), color: type === 'car' ? rng.pick(CAR_PAINT) : 0xffffff, fwd: new THREE.Vector3(), smoky: type === 'danfo' || (type === 'keke' ? rng.chance(0.6) : rng.chance(0.33)), visible: false, lights: this.brokenLights() };
        v.pos.copy(roads.at(edge, v.s).p);
        this.vehicles.push(v);
        this.sets[type].color(i, v.color);
      }
    }

    // Headlights, tail lights and the light the headlights throw on the road.
    const lightCount = this.vehicles.length * 2;
    const lightMesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.InstancedMesh(geo, mat, lightCount);
      m.frustumCulled = false;
      m.raycast = () => {};
      m.count = 0;
      for (let i = 0; i < lightCount; i++) m.setColorAt(i, new THREE.Color(0xffffff));
      scene.add(m);
      return m;
    };
    this.headGlow = lightMesh(new THREE.BoxGeometry(0.3, 0.16, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.tailGlow = lightMesh(new THREE.BoxGeometry(0.26, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.beams = lightMesh(poolGeometry(2.4, 7, 0, 4.4, 0.06), glowMaterial());
    this.beams.renderOrder = 4;

    // Agberos: groups of two to four at the dark lamps, the odd one at a lit corner.
    for (const spot of night.dark) this.gather(spot, rng.int(2, 4));
    for (const spot of night.lit) this.gather(spot, 1);

    // People: one instanced body, head, headwear and (for hawkers) a load on the head.
    const people = counts.walkers + hubSpots.length * 3 + this.agberos.length;
    this.bodies = new Instances(scene, new THREE.CapsuleGeometry(0.32, 0.8, 3, 8).translate(0, 0.72, 0), people, { outline: 0.03 });
    this.heads = new Instances(scene, new THREE.SphereGeometry(0.27, 10, 8).translate(0, 1.55, 0), people, { outline: 0.03 });
    this.hats = new Instances(scene, new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.8, 1.05).translate(0, 1.62, 0), people);
    this.loads = new Instances(scene, new THREE.CylinderGeometry(0.42, 0.3, 0.2, 12).translate(0, 1.95, 0), people, { outline: 0.03 });
    this.shadows = new Instances(scene, new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), people + this.vehicles.length, {
      material: new THREE.MeshBasicMaterial({ color: 0x1f3a3a, transparent: true, opacity: 0.2, depthWrite: false }),
    });
    for (let i = 0; i < counts.walkers; i++) {
      const edge = rng.chance(0.4) && busyEdges.length ? rng.pick(busyEdges) : rng.pick(roads.edges);
      this.walkers.push({ edge, s: rng.range(0, roads.length(edge)), dir: rng.chance(0.5) ? 1 : -1, speed: rng.range(1, 1.6), side: rng.chance(0.5) ? 1 : -1, idle: 0, phase: rng.range(0, 6), load: rng.chance(0.2), look: this.look(), owl: rng.next() });
    }
    // Small groups hanging about at the hub places.
    for (const spot of hubSpots) {
      for (let j = 0; j < 3; j++) {
        const up = spot.clone().normalize();
        const a = rng.range(0, Math.PI * 2);
        const tangent = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
        const other = tangent.clone().cross(up);
        const p = spot.clone().addScaledVector(tangent, Math.cos(a) * 1.6).addScaledVector(other, Math.sin(a) * 1.6).setLength(R);
        this.idlers.push({ p, up: p.clone().normalize(), face: spot.clone().sub(p).normalize(), phase: rng.range(0, 6), look: this.look() });
      }
    }
    // Prime the colour buffers so they exist before the first frame.
    for (let i = 0; i < people; i++) for (const s of [this.bodies, this.heads, this.hats, this.loads]) s.color(i, 0xffffff);
  }

  /** Most drivers have both lights; plenty run with one, some with none. */
  private brokenLights(): [boolean, boolean] {
    const r = this.rng.next();
    return r < 0.72 ? [true, true] : r < 0.8 ? [true, false] : r < 0.88 ? [false, true] : [false, false];
  }

  /** A loose ring of agberos round a spot, facing in. */
  private gather(spot: THREE.Vector3, n: number): void {
    const r = this.rng;
    const up = spot.clone().normalize();
    const tangent = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
    const other = tangent.clone().cross(up);
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + r.range(-0.4, 0.4);
      const rad = n === 1 ? 0 : r.range(0.8, 1.3);
      const p = spot.clone().addScaledVector(tangent, Math.cos(a) * rad).addScaledVector(other, Math.sin(a) * rad).setLength(R);
      const face = n === 1 ? tangent.clone() : spot.clone().sub(p).normalize();
      this.agberos.push({
        p,
        up: p.clone().normalize(),
        face,
        phase: r.range(0, 6),
        look: { body: r.pick([0x2b2f30, 0x3d4444, 0x5a3d33, 0x45503a, 0x6b2f2a]), head: r.pick(SKIN), hat: r.pick([0xb5302a, 0x161616, 0x161616]), load: 0 },
        // Some are out at dusk, the rest once it's properly dark.
        appear: r.range(0.35, 0.8),
      });
    }
  }

  private look(): Look {
    const r = this.rng;
    return {
      body: r.pick(CLOTHES),
      head: r.pick(SKIN),
      hat: r.chance(0.5) ? 0x1b1410 : r.pick(CLOTHES),
      load: r.pick([0x9aa3a8, 0xd9b44a, 0x5b8fb0, 0xc9584d]),
    };
  }

  /** Next street at a junction: never straight back unless it's a dead end; busy streets are favoured. */
  private next(a: Agent, vehicle: boolean): void {
    const node = a.dir === 1 ? a.edge.b : a.edge.a;
    const options = (this.adj.get(node) ?? []).filter((o) => o.edge !== a.edge);
    if (!options.length) {
      a.dir = a.dir === 1 ? -1 : 1;
      return;
    }
    const weights = options.map((o) => (vehicle && this.busy(o.edge) ? 3 : 1));
    let r = this.rng.range(0, weights.reduce((x, y) => x + y, 0));
    let pick = options[0]!;
    for (let i = 0; i < options.length; i++) if ((r -= weights[i]!) <= 0) (pick = options[i]!), (i = options.length);
    a.edge = pick.edge;
    a.dir = pick.from === 'a' ? 1 : -1;
    a.s = pick.from === 'a' ? 0 : this.roads.length(pick.edge);
  }

  private advance(a: Agent, dist: number, vehicle: boolean): void {
    a.s += a.dir * dist;
    const len = this.roads.length(a.edge);
    if (a.s > len || a.s < 0) {
      const over = a.s > len ? a.s - len : -a.s;
      this.next(a, vehicle);
      a.s += a.dir * over;
    }
  }

  /** Pose on the street: position with a sideways offset, facing the direction of travel. */
  private pose(a: Agent, offset: number, out: THREE.Matrix4, lift = 0): THREE.Vector3 {
    const { p, t, side } = this.roads.at(a.edge, a.s);
    const up = p.clone().normalize();
    _f.copy(t).multiplyScalar(a.dir);
    _p.copy(p).addScaledVector(side, offset * a.dir).setLength(R + lift);
    _x.crossVectors(up, _f).normalize();
    out.makeBasis(_x, up, _f).setPosition(_p);
    return _p.clone();
  }

  /**
   * focus: where the camera looks in play (null on the title screen, where everything on the
   * visible face of the planet counts as on screen).
   */
  /** obstacle: something traffic queues behind (the player's danfo). */
  update(dt: number, player: THREE.Vector3 | null, camera: THREE.Camera, obstacle: THREE.Vector3 | null = null, night = 0): void {
    this.t += dt;
    this.farClock += dt;
    const farTick = this.farClock >= Traffic.FAR_TICK;
    const farDt = this.farClock;
    if (farTick) this.farClock = 0;
    const camDir = camera.position.clone().normalize();
    // Scale with the camera distance (portrait phones pull back further and see more).
    const near = player ? Math.max(Traffic.NEAR, camera.position.distanceTo(player) * 1.2) : 0;
    const near2 = near * near;
    const onScreen = (p: THREE.Vector3) => (player ? p.distanceToSquared(player) < near2 : p.dot(camDir) > R * 0.15);

    let shadow = 0;
    const placeShadow = (p: THREE.Vector3, r: number) => {
      _o.position.copy(p).setLength(R + 0.05);
      _o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize());
      _o.scale.setScalar(r);
      _o.updateMatrix();
      this.shadows.set(shadow++, _o.matrix);
    };

    // --- Vehicles ---
    const slots: Record<VehicleType, number> = { car: 0, danfo: 0, keke: 0 };
    let heads = 0;
    let tails = 0;
    const headC = new THREE.Color(0x9a9a8e).lerp(new THREE.Color(0xfff6dc), night);
    const tailC = new THREE.Color(0x6a1a16).lerp(new THREE.Color(0xff3b2f), night);
    const beamC = new THREE.Color(0xfff0c8).multiplyScalar(0.45 * night);
    for (const v of this.vehicles) {
      const visible = onScreen(v.pos);
      v.visible = visible;
      if (!visible) {
        // Off screen: no car-following, just keep roughly moving at a typical pace.
        if (farTick) {
          v.speed = this.busy(v.edge) ? 1.2 : v.maxSpeed * 0.6;
          this.advance(v, v.speed * farDt, true);
          v.pos.copy(this.roads.at(v.edge, v.s).p);
        }
        continue;
      }
      const lenE = this.roads.length(v.edge);
      let target = this.busy(v.edge) ? Math.min(v.maxSpeed, 2.8) : v.maxSpeed;
      let gap = Infinity;
      for (const o of this.vehicles) {
        if (o === v || o.edge !== v.edge || o.dir !== v.dir) continue;
        const ahead = (o.s - v.s) * v.dir;
        if (ahead > 0 && ahead < gap) gap = ahead;
      }
      const toEnd = v.dir === 1 ? lenE - v.s : v.s;
      if (toEnd < 6) {
        const nodeP = this.roads.nodes[v.dir === 1 ? v.edge.b : v.edge.a];
        if (nodeP) {
          // Junction priority: only yield to lower-id vehicles in the junction, so nobody deadlocks.
          const id = this.vehicles.indexOf(v);
          for (let j = 0; j < id; j++) {
            const o = this.vehicles[j]!;
            if (o.edge !== v.edge && o.pos.distanceTo(nodeP) < 4) gap = Math.min(gap, toEnd + 2);
          }
        }
      }
      const here = this.roads.at(v.edge, v.s);
      // No braking for the player: in Lagos traffic, you get out of the way. They do queue
      // behind the player's danfo, though.
      if (obstacle) {
        const ahead = obstacle.clone().sub(here.p).dot(here.t.clone().multiplyScalar(v.dir));
        if (ahead > 0 && ahead < 7 && obstacle.distanceTo(here.p) < 7.5) gap = Math.min(gap, ahead - 1);
      }
      const safe = v.length + 1.5;
      if (gap < safe) target = 0;
      else if (gap < safe + 5) target = Math.min(target, (gap - safe) * 0.9);
      v.speed += THREE.MathUtils.clamp(target - v.speed, -8 * dt, 3 * dt);
      this.advance(v, Math.max(0, v.speed) * dt, true);
      const p = this.pose(v, v.edge.width / 4 + (v.type === 'keke' ? 0.2 : 0), _m);
      v.pos.copy(p);
      v.fwd.copy(_f);
      const slot = slots[v.type]++;
      this.sets[v.type].set(slot, _m);
      this.sets[v.type].color(slot, v.color);
      placeShadow(p, v.type === 'keke' ? 1.2 : 2.3);
      if (night > 0.03) {
        const L = LIGHTS[v.type];
        L.front.forEach((x, i) => {
          // A keke's one lamp counts as its left.
          if (!v.lights[L.front.length === 1 ? 0 : i]) return;
          this.headGlow.setMatrixAt(heads, _l.copy(_m).multiply(_t.makeTranslation(x, L.fy, L.fz)));
          this.headGlow.setColorAt(heads, headC);
          this.beams.setMatrixAt(heads, _l.copy(_m).multiply(_t.makeTranslation(x * 0.6, 0, 0)));
          this.beams.setColorAt(heads, beamC);
          heads++;
        });
        L.rear.forEach((x, i) => {
          if (!v.lights[i]) return;
          this.tailGlow.setMatrixAt(tails, _l.copy(_m).multiply(_t.makeTranslation(x, L.ry, L.rz)));
          this.tailGlow.setColorAt(tails++, tailC);
        });
      }
    }
    this.headGlow.count = this.beams.count = heads;
    this.tailGlow.count = tails;
    for (const m of [this.headGlow, this.beams, this.tailGlow]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    for (const type of ['car', 'danfo', 'keke'] as const) {
      this.sets[type].draw(slots[type]);
      this.sets[type].commit();
    }

    // --- People ---
    let n = 0;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const drawPerson = (m: THREE.Matrix4, look: Look, load: boolean, p: THREE.Vector3) => {
      this.bodies.set(n, m);
      this.heads.set(n, m);
      this.hats.set(n, m);
      this.loads.set(n, load ? m : hide);
      this.bodies.color(n, look.body);
      this.heads.color(n, look.head);
      this.hats.color(n, look.hat);
      this.loads.color(n, look.load);
      placeShadow(p, 0.5);
      n++;
    };
    for (const w of this.walkers) {
      const { p: wp } = this.roads.at(w.edge, w.s);
      if (!onScreen(wp)) {
        if (farTick) this.advance(w, w.speed * farDt * 0.8, false);
        continue;
      }
      if (w.idle > 0) w.idle -= dt;
      else {
        this.advance(w, w.speed * dt, false);
        if (this.rng.chance(dt * 0.04)) w.idle = this.rng.range(2, 6);
      }
      const offset = w.side * (w.edge.width / 2 + Math.max(0.6, w.edge.shoulder * 0.55));
      const p = this.pose(w, offset, _m, w.idle > 0 ? 0 : Math.abs(Math.sin(this.t * 7 + w.phase)) * 0.06);
      if (!this.outAtNight(w.owl, p, night)) continue;
      drawPerson(_m, w.look, w.load, p);
    }
    for (const [i, idl] of this.idlers.entries()) {
      if (!onScreen(idl.p) || !this.outAtNight((i * 0.618) % 1, idl.p, night)) continue;
      const face = idl.face.clone().applyAxisAngle(idl.up, Math.sin(this.t * 1.5 + idl.phase) * 0.15);
      _x.crossVectors(idl.up, face).normalize();
      _m.makeBasis(_x, idl.up, face).setPosition(idl.p);
      drawPerson(_m, idl.look, false, idl.p);
    }
    for (const ag of this.agberos) {
      if (night < ag.appear || !onScreen(ag.p)) continue;
      const face = ag.face.clone().applyAxisAngle(ag.up, Math.sin(this.t * 1.1 + ag.phase) * 0.35);
      _x.crossVectors(ag.up, face).normalize();
      _m.makeBasis(_x, ag.up, face).setPosition(ag.p);
      drawPerson(_m, ag.look, false, ag.p);
    }
    for (const s of [this.bodies, this.heads, this.hats, this.loads]) {
      s.draw(n);
      s.commit();
    }
    this.shadows.draw(shadow);
    this.shadows.commit();
  }

  /**
   * After dark most people head home: under working lamps about half stay out, in the dark
   * almost nobody does (that's where the agberos are).
   */
  private outAtNight(owl: number, p: THREE.Vector3, night: number): boolean {
    if (night <= 0.05) return true;
    return owl < 1 - night * (this.night.isLit(p) ? 0.5 : 0.88);
  }

  /** Exhaust points of visible, smoky vehicles that are moving (rear, just above the road). */
  exhausts(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const v of this.vehicles) {
      if (!v.visible || !v.smoky || v.speed < 0.3) continue;
      const up = v.pos.clone().normalize();
      out.push(v.pos.clone().addScaledVector(v.fwd, -v.length / 2).addScaledVector(up, v.type === 'keke' ? 0.4 : 0.5));
    }
    return out;
  }

  /**
   * Keeps the player from walking through vehicles. Mutates p. Returns the fastest vehicle that
   * struck the player this frame (for damage), throwing them clear along its path.
   */
  pushOut(p: THREE.Vector3): { vehicle: VehicleType; speed: number } | null {
    let hit: { vehicle: VehicleType; speed: number } | null = null;
    const len = p.length();
    for (const v of this.vehicles) {
      const vp = v.pos;
      if (vp.distanceToSquared(p) > 25) continue;
      const d = p.distanceTo(vp);
      const r = v.type === 'keke' ? 1.3 : 2.2;
      if (d >= r || d < 1e-4) continue;
      const away = p.clone().sub(vp).normalize();
      p.addScaledVector(away, r - d);
      if (v.speed > 1.5) {
        // Thrown forward and to the side, harder the faster it was going.
        p.addScaledVector(away, 0.12 * v.speed).addScaledVector(v.fwd, 0.1 * v.speed);
        if (!hit || v.speed > hit.speed) hit = { vehicle: v.type, speed: v.speed };
      }
      p.setLength(len);
    }
    return hit;
  }
}
