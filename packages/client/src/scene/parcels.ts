import * as THREE from 'three';
import { PARCEL, PARCEL_COLOURS, seeded, type Errand } from '@9ja/shared';
import type { Collisions } from './collision';
import { Frame } from './sphere';
import { Character, type Body, type Outfit } from './character';

const SKINS = [0x4a2f1f, 0x5a3a24, 0x6b4226, 0x6b4a33, 0x3d2618];
const HAIR: Body['hair'][] = ['low', 'afro', 'puff', 'braids', 'bald'];
const LEGS = [0x34465e, 0x2c2f38, 0xb8a27a, 0x5b8fb0, 0x2b2f30];
export const ASK_RADIUS = 2.2;

interface Person {
  /** Ground position (kept by reference: speech bubbles follow it). */
  at: THREE.Vector3;
  frame: Frame;
  root: THREE.Group;
  character: Character;
  facing: THREE.Vector3;
  /** Has said something, so the HUD can offer the next step. */
  asked: boolean;
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * The people hanging about a parcel's drop-off: a handful of passers-by, one of whom is waiting
 * for it. The recipient wears the colour in the clue; so does at least one other person, so you
 * still have to ask round. Built when you take a parcel, gone a little after it's settled.
 */
export class ParcelCrowd {
  private people: Person[] = [];
  private seed: number | null = null;
  private leaveIn = 0;

  constructor(
    private scene: THREE.Scene,
    private doorOf: (id: Errand['to']) => THREE.Vector3,
    private collisions: Collisions,
    private heightAt: (p: THREE.Vector3) => number,
  ) {}

  /** Keep the crowd in step with the parcel being carried. */
  sync(errand: Errand | null, dt: number): void {
    if (errand && errand.seed !== this.seed) {
      this.clear();
      this.build(errand);
    } else if (!errand && this.people.length) {
      // Linger a moment so the thank-you can be read, then go.
      this.leaveIn = this.leaveIn > 0 ? this.leaveIn - dt : 6;
      if (this.leaveIn <= dt) this.clear();
    }
  }

  private build(e: Errand): void {
    this.seed = e.seed;
    this.leaveIn = 0;
    const r = seeded(e.seed ^ 0x5eed);
    const pick = <T,>(l: readonly T[]) => l[Math.floor(r() * l.length)]!;
    const door = Frame.fromPoint(this.doorOf(e.to));
    // Colours: the recipient's, one look-alike, the rest anything else.
    const others = PARCEL_COLOURS.map((_, i) => i).filter((i) => i !== e.colour);
    const twin = (e.who + 1 + Math.floor(r() * (PARCEL.crowd - 1))) % PARCEL.crowd;
    for (let i = 0; i < PARCEL.crowd; i++) {
      // Spread round the landmark, a few steps from its door.
      const a = (i / PARCEL.crowd) * Math.PI * 2 + r() * 0.8;
      const d = 3.5 + r() * 5;
      const at = door.toWorld(Math.cos(a) * d, 0, Math.sin(a) * d);
      this.collisions.resolve(at, 0.5);
      at.setLength(at.length() + this.heightAt(at));
      const colour = i === e.who || i === twin ? e.colour : pick(others);
      const body: Body = { skin: pick(SKINS), hair: pick(HAIR), hairColor: 0x1b1410, build: 0.92 + r() * 0.2 };
      const outfit: Outfit = {
        top: { style: pick(['tee', 'tee', 'shirt', 'buba', 'singlet'] as const), color: PARCEL_COLOURS[colour]!.hex },
        bottom: { style: pick(['trousers', 'trousers', 'shorts', 'wrapper'] as const), color: pick(LEGS) },
        shoes: { style: pick(['slippers', 'sneakers', 'sandals'] as const), color: pick([0x283130, 0x7a4a2a, 0xf4f1e6]) },
        ...(r() < 0.4 ? { hat: { style: pick(['cap', 'beanie', 'kufi'] as const), color: pick([0x283130, 0xc9584d, 0xd8d3c4]) } } : {}),
      };
      const character = new Character(body, outfit);
      const root = new THREE.Group();
      root.matrixAutoUpdate = false;
      root.add(character.root);
      this.scene.add(root);
      const frame = Frame.fromPoint(at);
      // Facing somewhere idle to start with.
      const facing = frame.e.clone().multiplyScalar(Math.cos(a * 3)).addScaledVector(frame.s, Math.sin(a * 3));
      this.people.push({ at, frame, root, character, facing, asked: false });
    }
  }

  private clear(): void {
    for (const p of this.people) {
      p.root.removeFromParent();
      p.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.people = [];
    this.seed = null;
    this.leaveIn = 0;
  }

  /** The closest person within asking distance, by index. */
  nearest(player: THREE.Vector3): number | null {
    let best: number | null = null;
    let bestD = ASK_RADIUS;
    this.people.forEach((p, i) => {
      const d = p.at.distanceTo(player);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  at(i: number): THREE.Vector3 {
    return this.people[i]!.at;
  }

  asked(i: number): boolean {
    return this.people[i]?.asked ?? false;
  }

  markAsked(i: number): void {
    const p = this.people[i];
    if (p) p.asked = true;
  }

  get active(): boolean {
    return this.people.length > 0;
  }

  update(dt: number, player: THREE.Vector3 | null): void {
    for (const p of this.people) {
      const up = p.frame.n;
      // Turn to whoever walks up.
      if (player && p.at.distanceTo(player) < 5) {
        _v.subVectors(player, p.at).addScaledVector(up, -_v.dot(up));
        if (_v.lengthSq() > 1e-4) p.facing.lerp(_v.normalize(), 1 - Math.exp(-6 * dt));
      }
      p.facing.addScaledVector(up, -p.facing.dot(up)).normalize();
      _x.crossVectors(up, p.facing);
      p.root.matrix.copy(_m.makeBasis(_x, up, p.facing).setPosition(p.at));
      p.character.animate(dt, 0);
    }
  }
}
