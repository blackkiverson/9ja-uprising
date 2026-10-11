import * as THREE from 'three';
import { NPCS, type NpcId } from '@9ja/shared';
import type { Frame } from './sphere';
import { toonMesh } from './toon';

type Hat = 'headtie' | 'fila' | 'cap' | 'kufi' | 'afro';
interface Look {
  outfit: number;
  skin: number;
  hat: Hat;
  hatColor: number;
  /** Long wrapper or kaftan instead of shirt and trousers. */
  long?: boolean;
}

// Fictional characters; outfits nod to everyday Lagos dress.
const LOOKS: Record<NpcId, Look> = {
  mama_nkechi: { outfit: 0xc9584d, skin: 0x5a3a24, hat: 'headtie', hatColor: 0xd9b44a, long: true },
  oga_bayo: { outfit: 0xe9ecdf, skin: 0x6b4226, hat: 'fila', hatColor: 0x5b8fb0 },
  tunde: { outfit: 0xe3b843, skin: 0x4a2f1f, hat: 'cap', hatColor: 0x283130 },
  mallam_sani: { outfit: 0xeef0e6, skin: 0x6b4a33, hat: 'kufi', hatColor: 0xd8d3c4, long: true },
  kelz: { outfit: 0x8e5bb5, skin: 0x5a3a24, hat: 'cap', hatColor: 0xc9584d },
};

function figure(look: Look): THREE.Group {
  const g = new THREE.Group();
  const body = look.long
    ? toonMesh(new THREE.CylinderGeometry(0.38, 0.6, 1.6, 10), look.outfit)
    : toonMesh(new THREE.CapsuleGeometry(0.43, 0.95, 4, 8), look.outfit);
  body.position.y = look.long ? 0.8 : 0.93;
  const head = toonMesh(new THREE.SphereGeometry(0.37, 12, 10), look.skin);
  head.position.y = 1.92;
  g.add(body, head);
  let hat: THREE.Mesh;
  switch (look.hat) {
    case 'headtie': {
      hat = toonMesh(new THREE.SphereGeometry(0.46, 12, 8), look.hatColor);
      hat.scale.set(1.15, 0.75, 1.1);
      hat.position.y = 2.18;
      const knot = toonMesh(new THREE.SphereGeometry(0.2, 8, 6), look.hatColor);
      knot.position.set(0, 2.38, -0.22);
      g.add(knot);
      break;
    }
    case 'fila':
      hat = toonMesh(new THREE.CylinderGeometry(0.34, 0.38, 0.32, 12), look.hatColor);
      hat.position.y = 2.24;
      hat.rotation.z = 0.25;
      break;
    case 'kufi':
      hat = toonMesh(new THREE.CylinderGeometry(0.36, 0.38, 0.22, 12), look.hatColor);
      hat.position.y = 2.2;
      break;
    case 'cap': {
      hat = toonMesh(new THREE.SphereGeometry(0.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), look.hatColor);
      hat.position.y = 2.02;
      const brim = toonMesh(new THREE.BoxGeometry(0.42, 0.05, 0.36), look.hatColor);
      brim.position.set(0, 2.04, 0.42);
      g.add(brim);
      break;
    }
    default:
      hat = toonMesh(new THREE.SphereGeometry(0.42, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), look.hatColor);
      hat.position.y = 1.98;
  }
  g.add(hat);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x1f3a3a, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.position.y = 0.05;
  g.add(shadow);
  return g;
}

interface NpcView {
  id: NpcId;
  frame: Frame;
  root: THREE.Group;
  body: THREE.Group;
  tag: HTMLElement;
  facing: THREE.Vector3;
  phase: number;
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _v = new THREE.Vector3();

export const TALK_RADIUS = 2.6;

/** The five NPCs: idle in place, turn to face you when you come close, name tag when near. */
export class Npcs {
  private views: NpcView[] = [];

  constructor(scene: THREE.Scene, spots: Record<NpcId, Frame>, tagLayer: HTMLElement) {
    let phase = 0;
    for (const id of Object.keys(spots) as NpcId[]) {
      const frame = spots[id];
      const root = new THREE.Group();
      root.matrixAutoUpdate = false;
      const body = figure(LOOKS[id]);
      root.add(body);
      scene.add(root);
      const tag = document.createElement('div');
      tag.className = 'npc-tag';
      tag.textContent = NPCS[id].name;
      tagLayer.append(tag);
      this.views.push({ id, frame, root, body, tag, facing: frame.s.clone(), phase: (phase += 1.7) });
    }
  }

  position(id: NpcId): THREE.Vector3 {
    return this.views.find((v) => v.id === id)!.frame.c;
  }

  /** Closest NPC within talking range of the player, if any. */
  nearest(player: THREE.Vector3): NpcId | null {
    let best: NpcId | null = null;
    let bestD = TALK_RADIUS;
    for (const v of this.views) {
      const d = v.frame.c.distanceTo(player);
      if (d < bestD) {
        best = v.id;
        bestD = d;
      }
    }
    return best;
  }

  update(t: number, dt: number, player: THREE.Vector3 | null, camera: THREE.Camera, showTags: boolean): void {
    for (const v of this.views) {
      const up = v.frame.n;
      // Turn smoothly towards the player when they are close, otherwise keep the last facing.
      if (player && v.frame.c.distanceTo(player) < 8) {
        _v.subVectors(player, v.frame.c).addScaledVector(up, -_v.dot(up));
        if (_v.lengthSq() > 1e-4) v.facing.lerp(_v.normalize(), 1 - Math.exp(-6 * dt));
      }
      v.facing.addScaledVector(up, -v.facing.dot(up)).normalize();
      _x.crossVectors(up, v.facing);
      v.root.matrix.copy(_m.makeBasis(_x, up, v.facing).setPosition(v.frame.c));
      v.body.position.y = Math.abs(Math.sin(t * 2 + v.phase)) * 0.04; // idle bounce

      // Name tag above the head, only when near and on the visible side of the planet.
      const head = v.frame.toWorld(0, 2.9, 0);
      const near = player !== null && v.frame.c.distanceTo(player) < 9;
      const facingUs = head.clone().sub(camera.position).dot(up) < 0;
      if (showTags && near && facingUs) {
        head.project(camera);
        v.tag.style.display = 'block';
        v.tag.style.transform = `translate(-50%, -100%) translate(${((head.x + 1) / 2) * innerWidth}px, ${((1 - head.y) / 2) * innerHeight}px)`;
      } else v.tag.style.display = 'none';
    }
  }
}
