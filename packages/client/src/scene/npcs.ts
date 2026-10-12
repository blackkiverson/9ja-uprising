import * as THREE from 'three';
import { NPCS, type NpcId } from '@9ja/shared';
import type { Frame } from './sphere';
import { Character, OUTFITS, type Body, type Outfit } from './character';

// Fictional characters; outfits nod to everyday Lagos dress.
const LOOKS: Record<NpcId, { body: Body; outfit: Outfit }> = {
  mama_nkechi: {
    body: { skin: 0x5a3a24, hair: 'puff', hairColor: 0x1b1410, build: 1.1 },
    outfit: {
      top: { style: 'buba', color: 0xc9584d, accent: 0xd9b44a },
      bottom: { style: 'wrapper', color: 0xc9584d, accent: 0xd9b44a },
      shoes: { style: 'slippers', color: 0x7a4a2a },
      hat: { style: 'headtie', color: 0xd9b44a, accent: 0xc9584d },
    },
  },
  oga_bayo: {
    body: { skin: 0x6b4226, hair: 'low', hairColor: 0x2a2420, build: 1.15 },
    outfit: { ...OUTFITS.owambe, top: { style: 'buba', color: 0xe9ecdf, accent: 0x5b8fb0 }, bottom: { style: 'trousers', color: 0xe9ecdf }, hat: { style: 'fila', color: 0x5b8fb0 } },
  },
  tunde: {
    body: { skin: 0x4a2f1f, hair: 'low', hairColor: 0x1b1410, build: 0.95 },
    outfit: { top: { style: 'tee', color: 0xe3b843 }, bottom: { style: 'shorts', color: 0x34465e }, shoes: { style: 'sneakers', color: 0xe9ecdf, accent: 0x283130 }, hat: { style: 'cap', color: 0x283130 } },
  },
  mallam_sani: {
    body: { skin: 0x6b4a33, hair: 'bald', hairColor: 0x2a2420 },
    outfit: OUTFITS.jalabiya,
  },
  kelz: {
    body: { skin: 0x5a3a24, hair: 'braids', hairColor: 0x1b1410, build: 0.92 },
    outfit: { top: { style: 'singlet', color: 0x8e5bb5 }, bottom: { style: 'trousers', color: 0x283130 }, shoes: { style: 'sneakers', color: 0xf4f1e6, accent: 0x8e5bb5 }, hat: { style: 'cap', color: 0xc9584d } },
  },
};

function figure(look: { body: Body; outfit: Outfit }): { group: THREE.Group; character: Character } {
  const g = new THREE.Group();
  const character = new Character(look.body, look.outfit);
  g.add(character.root);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x1f3a3a, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.position.y = 0.05;
  g.add(shadow);
  return { group: g, character };
}

interface NpcView {
  id: NpcId;
  frame: Frame;
  root: THREE.Group;
  body: THREE.Group;
  character: Character;
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
      const { group: body, character } = figure(LOOKS[id]);
      root.add(body);
      scene.add(root);
      const tag = document.createElement('div');
      tag.className = 'npc-tag';
      tag.textContent = NPCS[id].name;
      tagLayer.append(tag);
      this.views.push({ id, frame, root, body, character, tag, facing: frame.s.clone(), phase: (phase += 1.7) });
    }
  }

  position(id: NpcId): THREE.Vector3 {
    return this.views.find((v) => v.id === id)!.frame.c;
  }

  /** Closest NPC within talking range of the player, if any. */
  /** Where the NPCs near a point stand, for the camera to visit. */
  subjects(near: THREE.Vector3, r: number): THREE.Vector3[] {
    return this.views.filter((v) => v.frame.c.distanceTo(near) < r).map((v) => v.frame.c);
  }

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
      v.character.animate(dt, 0);

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
