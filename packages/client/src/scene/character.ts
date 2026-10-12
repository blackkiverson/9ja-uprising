import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { outlineMaterial, toonMaterial } from './toon';

/*
 * A rigged, low-poly figure built from primitives, dressed from an Outfit.
 *
 * The body is a small bone tree (hips > chest > head, shoulders > elbows > hands, hips > knees >
 * feet) so it can walk, jump and fall. Clothing is data: each slot (top, bottom, shoes, hat) picks
 * a style and colours, which decides the colour of the body segments it covers and adds any extra
 * pieces (sleeves, cuffs, hems, skirts, soles, hats). The pieces are baked into one skinned mesh
 * bound rigidly to the bones, so a dressed figure costs two draw calls (three with the x-ray
 * ghost), and changing clothes is just a re-bake. Outfits can be bought and swapped in play later
 * without touching the rig.
 *
 * Local axes: +y up, +z the way the figure faces.
 */

export type HairStyle = 'afro' | 'low' | 'puff' | 'braids' | 'bald';
export type TopStyle = 'tee' | 'singlet' | 'shirt' | 'buba' | 'kaftan';
export type BottomStyle = 'trousers' | 'shorts' | 'wrapper';
export type ShoeStyle = 'slippers' | 'sneakers' | 'sandals' | 'shoes';
export type HatStyle = 'cap' | 'fila' | 'kufi' | 'headtie' | 'beanie';

export interface Garment<S extends string> {
  style: S;
  color: number;
  /** Trim: collars, soles, bands, embroidery. */
  accent?: number;
}

export interface Outfit {
  top: Garment<TopStyle>;
  bottom: Garment<BottomStyle>;
  shoes: Garment<ShoeStyle>;
  hat?: Garment<HatStyle>;
}

export interface Body {
  skin: number;
  hair: HairStyle;
  hairColor: number;
  /** Shoulder and chest width, around 0.9 (slight) to 1.15 (broad). */
  build?: number;
}

/** Starter looks. Outfit items will come from the shop later; these are the building blocks. */
export const OUTFITS = {
  starter: {
    top: { style: 'tee', color: 0x2e7d5b },
    bottom: { style: 'trousers', color: 0x34465e },
    shoes: { style: 'slippers', color: 0x283130 },
  },
  street: {
    top: { style: 'singlet', color: 0xe9ecdf },
    bottom: { style: 'shorts', color: 0x5b8fb0 },
    shoes: { style: 'sneakers', color: 0xc9584d, accent: 0xf4f1e6 },
    hat: { style: 'cap', color: 0x283130 },
  },
  office: {
    top: { style: 'shirt', color: 0xd9e4ee, accent: 0x34465e },
    bottom: { style: 'trousers', color: 0x2c2f38 },
    shoes: { style: 'shoes', color: 0x3a2618 },
  },
  owambe: {
    top: { style: 'buba', color: 0xd9b44a, accent: 0x7a3b2e },
    bottom: { style: 'trousers', color: 0xd9b44a },
    shoes: { style: 'sandals', color: 0x7a4a2a },
    hat: { style: 'fila', color: 0x7a3b2e },
  },
  jalabiya: {
    top: { style: 'kaftan', color: 0xeef0e6, accent: 0xb9b3a0 },
    bottom: { style: 'trousers', color: 0xeef0e6 },
    shoes: { style: 'sandals', color: 0x5a3a24 },
    hat: { style: 'kufi', color: 0xd8d3c4 },
  },
} satisfies Record<string, Outfit>;
export type OutfitId = keyof typeof OUTFITS;

interface Limb {
  /** Shoulder or hip joint. */
  upper: THREE.Bone;
  /** Elbow or knee joint. */
  lower: THREE.Bone;
  /** Hand or ankle. */
  end: THREE.Bone;
  /** -1 on the left (−x), +1 on the right. */
  side: number;
}

/** One primitive of the figure: its shape in its bone's space, a colour, and the bone it rides. */
interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  bone: THREE.Bone;
  outline: boolean;
}

const HIP_Y = 0.94;
const INK = 0x283130;
const LONG_TOP: TopStyle[] = ['kaftan'];

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _mx = new THREE.Matrix4();

/** Scale, then rotate, then move a geometry, the same order a mesh applies its transform. */
function at(geo: THREE.BufferGeometry, p: [number, number, number], s: [number, number, number] = [1, 1, 1], r: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  return geo.applyMatrix4(_mx.compose(_p.set(...p), _q.setFromEuler(_e.set(...r)), _s.set(...s)));
}

/** Capsule hanging down from its joint, overlapping the next joint by its radius. */
function hanging(r: number, len: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, 4, 10).translate(0, -(len / 2 + r * 0.5), 0);
}

let ghostMat: THREE.MeshBasicMaterial | null = null;
/**
 * X-ray silhouette, drawn only where the world is in front. It sits in the opaque pass (custom
 * blending keeps it see-through) and renders before the figure, so the figure never hides its own
 * limbs: an arm behind the chest is not a "wall".
 */
function ghost(): THREE.MeshBasicMaterial {
  return (ghostMat ??= new THREE.MeshBasicMaterial({
    color: INK,
    opacity: 0.45,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
  }));
}

/**
 * Bakes parts into one skinned geometry: every part is moved into the figure's rest pose and bound
 * rigidly (weight 1) to its bone. hull: welded copies with smooth normals, for the outline.
 */
function bake(parts: Part[], index: Map<THREE.Bone, number>, rest: Map<THREE.Bone, THREE.Matrix4>, hull: boolean): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const color = new THREE.Color();
  for (const part of parts) {
    if (hull && !part.outline) continue;
    let g = part.geo.clone().applyMatrix4(rest.get(part.bone)!);
    if (hull) {
      const bare = new THREE.BufferGeometry();
      bare.setAttribute('position', g.getAttribute('position'));
      if (g.index) bare.setIndex(g.index);
      g = mergeVertices(bare, 1e-3);
      g.computeVertexNormals();
    } else {
      g.deleteAttribute('uv');
      if (!g.index) g = mergeVertices(g);
      color.setHex(part.color);
      const n = g.getAttribute('position').count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) color.toArray(c, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    const n = g.getAttribute('position').count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const b = index.get(part.bone)!;
    for (let i = 0; i < n; i++) {
      si[i * 4] = b;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geos.push(g);
  }
  const merged = mergeGeometries(geos)!;
  for (const g of geos) g.dispose();
  merged.computeBoundingSphere();
  // Room for limbs to swing and the figure to lie flat.
  merged.boundingSphere!.radius += 0.6;
  return merged;
}

export class Character {
  /** Place and turn this; knock-downs can rotate it too. */
  readonly root = new THREE.Group();
  private hips = new THREE.Bone();
  private chest = new THREE.Bone();
  private head = new THREE.Bone();
  private arms: Limb[] = [];
  private legs: Limb[] = [];
  private skeleton!: THREE.Skeleton;
  private boneIndex = new Map<THREE.Bone, number>();
  private rest = new Map<THREE.Bone, THREE.Matrix4>();
  private material = toonMaterial(0xffffff, { vertexColors: true });
  /** Body, outline and (for the player) x-ray ghost: the whole figure in two or three draw calls. */
  private meshes: THREE.SkinnedMesh[] = [];
  private skirt = false;
  private phase = 0;
  private t = Math.random() * 10;
  private run = 0;
  private air = 0;

  constructor(
    private body: Body,
    private outfit: Outfit = OUTFITS.starter,
    private opts: { xray?: boolean } = {},
  ) {
    this.rig();
    this.rebuild();
  }

  get currentOutfit(): Outfit {
    return this.outfit;
  }

  setBody(body: Body): void {
    this.body = body;
    this.rebuild();
  }

  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
    this.rebuild();
  }

  // ---------------------------------------------------------------- rig

  private rig(): void {
    const w = this.body.build ?? 1;
    const bone = (parent: THREE.Object3D, x: number, y: number, z = 0) => {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      parent.add(b);
      return b;
    };
    this.root.add(this.hips);
    this.hips.position.y = HIP_Y;
    this.hips.add(this.chest);
    this.chest.add(this.head);
    this.head.position.y = 1.1;
    for (const side of [-1, 1]) {
      const upper = bone(this.chest, side * 0.36 * w, 0.66);
      const lower = bone(upper, 0, -0.36);
      this.arms.push({ upper, lower, end: bone(lower, 0, -0.34), side });
      const hip = bone(this.hips, side * 0.15, -0.04);
      const knee = bone(hip, 0, -0.43);
      this.legs.push({ upper: hip, lower: knee, end: bone(knee, 0, -0.41), side });
    }
    // Rest pose: each bone's transform from the figure root, before any animation.
    const bones: THREE.Bone[] = [];
    this.hips.traverse((o) => {
      if (!(o instanceof THREE.Bone)) return;
      o.updateMatrix();
      const m = o.matrix.clone();
      if (o.parent instanceof THREE.Bone) m.premultiply(this.rest.get(o.parent)!);
      this.rest.set(o, m);
      this.boneIndex.set(o, bones.length);
      bones.push(o);
    });
    this.skeleton = new THREE.Skeleton(bones, bones.map((b) => this.rest.get(b)!.clone().invert()));
  }

  // ---------------------------------------------------------------- looks

  /** Everything the body and outfit put on the rig, as parts in bone space. */
  private parts(): Part[] {
    const parts: Part[] = [];
    const { body, outfit } = this;
    const { top, bottom, shoes, hat } = outfit;
    const w = body.build ?? 1;
    const skin = body.skin;
    const add = (geo: THREE.BufferGeometry, color: number, bone: THREE.Bone, outline = true) => parts.push({ geo, color, bone, outline });
    const trim = (g: Garment<string>, fallback: number) => g.accent ?? fallback;

    // What each garment covers.
    const sleeveUpper = top.style !== 'singlet' && top.style !== 'tee';
    const sleeveLower = top.style === 'shirt' || top.style === 'buba' || top.style === 'kaftan';
    const footSkin = shoes.style === 'slippers' || shoes.style === 'sandals';

    // Body
    add(at(new THREE.CylinderGeometry(0.29 * w, 0.27, 0.26, 12), [0, -0.02, 0]), bottom.color, this.hips);
    add(at(new THREE.CapsuleGeometry(0.27, 0.3, 4, 12), [0, 0.42, 0], [1.2 * w, 1, 0.8]), top.color, this.chest);
    add(at(new THREE.CylinderGeometry(0.1, 0.11, 0.18, 8), [0, 0.86, 0]), skin, this.chest);

    // Head: skull, ears, nose and eyes, so you can tell which way someone is looking.
    add(at(new THREE.SphereGeometry(0.33, 16, 12), [0, 0, 0], [0.96, 1.04, 1]), skin, this.head);
    for (const sx of [-1, 1]) {
      add(at(new THREE.SphereGeometry(0.07, 8, 6), [sx * 0.31, -0.01, 0], [0.6, 1, 0.8]), skin, this.head, false);
      add(at(new THREE.SphereGeometry(0.05, 8, 6), [sx * 0.12, 0.04, 0.3], [0.8, 1.15, 0.6]), 0x1a1410, this.head, false);
    }
    add(at(new THREE.SphereGeometry(0.055, 8, 6), [0, -0.05, 0.33]), skin, this.head, false);

    for (const arm of this.arms) {
      add(hanging(0.1, 0.26), sleeveUpper ? top.color : skin, arm.upper);
      add(hanging(0.09, 0.22), sleeveLower ? top.color : skin, arm.lower);
      add(at(new THREE.SphereGeometry(0.1, 10, 8), [0, 0, 0], [0.85, 1.1, 0.9]), skin, arm.end);
      // Shoulder cap bridges chest and arm, so sleeves start at the neckline, not mid-arm.
      if (top.style !== 'singlet') add(at(new THREE.SphereGeometry(0.14, 12, 8), [0, -0.03, 0], [1, 0.95, 1]), top.color, arm.upper);
      if (top.style === 'tee') add(at(new THREE.CylinderGeometry(0.14, 0.13, 0.24, 10), [0, -0.12, 0]), top.color, arm.upper);
      // Cuffs make long sleeves read as cloth, not skin painted a colour.
      if (sleeveLower) add(at(new THREE.CylinderGeometry(0.105, 0.11, 0.06, 10), [0, -0.28, 0]), trim(top, top.color), arm.lower);
    }
    for (const leg of this.legs) {
      add(hanging(0.13, 0.3), bottom.color, leg.upper);
      add(hanging(0.11, 0.3), bottom.style === 'shorts' ? skin : bottom.color, leg.lower);
      add(at(new THREE.BoxGeometry(0.2, 0.12, 0.34), [0, -0.03, 0.06]), footSkin ? skin : shoes.color, leg.end);
      if (bottom.style === 'shorts') add(at(new THREE.CylinderGeometry(0.16, 0.17, 0.12, 10), [0, -0.33, 0]), bottom.color, leg.upper);
      if (bottom.style === 'trousers') add(at(new THREE.CylinderGeometry(0.12, 0.13, 0.06, 10), [0, -0.36, 0]), bottom.color, leg.lower);
      add(at(new THREE.BoxGeometry(0.22, 0.04, 0.37), [0, -0.095, 0.06]), footSkin ? shoes.color : trim(shoes, INK), leg.end, false);
      if (footSkin) add(at(new THREE.BoxGeometry(0.23, 0.05, 0.1), [0, -0.03, 0.1]), trim(shoes, shoes.color), leg.end, false);
    }

    // Top details
    if (top.style === 'shirt') {
      add(at(new THREE.CylinderGeometry(0.14, 0.17, 0.08, 12), [0, 0.8, 0]), trim(top, 0xf4f1e6), this.chest);
      add(at(new THREE.BoxGeometry(0.06, 0.5, 0.02), [0, 0.45, 0.22]), trim(top, 0xf4f1e6), this.chest, false);
    }
    // Embroidered neck panel, the detail that makes native wear read as native wear.
    if (top.style === 'buba' || top.style === 'kaftan') add(at(new THREE.CylinderGeometry(0.11, 0.07, 0.34, 10), [0, 0.62, 0.215], [1, 1, 0.3]), trim(top, 0xd9b44a), this.chest, false);
    if (top.style === 'buba') add(new THREE.CylinderGeometry(0.34, 0.37, 0.24, 14), top.color, this.hips);
    if (top.style === 'singlet') add(at(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.72, 0.17], [1.1, 0.6, 0.4]), skin, this.chest, false);

    // Long garments hang from the hips as a skirt; legs swing less so they stay inside.
    this.skirt = bottom.style === 'wrapper' || LONG_TOP.includes(top.style);
    if (bottom.style === 'wrapper') {
      add(at(new THREE.CylinderGeometry(0.33, 0.44, 0.86, 14), [0, -0.4, 0]), bottom.color, this.hips);
      add(at(new THREE.CylinderGeometry(0.332, 0.35, 0.07, 14), [0, -0.04, 0]), trim(bottom, 0xf4f1e6), this.hips, false);
    }
    if (top.style === 'kaftan') {
      add(at(new THREE.CylinderGeometry(0.34, 0.47, 0.8, 14), [0, -0.32, 0]), top.color, this.hips);
      add(at(new THREE.CylinderGeometry(0.472, 0.475, 0.05, 14), [0, -0.7, 0]), trim(top, top.color), this.hips, false);
    }

    // Hair. Bulky hair hides under a hat; an afro lifts the hat a little.
    const hc = body.hairColor;
    const hairShows = !hat || body.hair === 'braids' || body.hair === 'low';
    if (hairShows) {
      switch (body.hair) {
        case 'afro':
          // A full ball set back on the skull: where it meets the forehead gives a rounded hairline.
          add(at(new THREE.SphereGeometry(0.4, 16, 12), [0, 0.12, -0.12]), hc, this.head);
          break;
        case 'puff':
          add(new THREE.SphereGeometry(0.345, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), hc, this.head);
          add(at(new THREE.SphereGeometry(0.17, 10, 8), [0, 0.3, -0.18]), hc, this.head);
          break;
        case 'braids':
          add(new THREE.SphereGeometry(0.345, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hc, this.head);
          for (let i = 0; i < 5; i++) {
            const a = Math.PI + (i - 2) * 0.32;
            add(at(new THREE.CylinderGeometry(0.035, 0.03, 0.42, 5), [Math.sin(a) * 0.29, -0.2, Math.cos(a) * 0.29]), hc, this.head, false);
          }
          break;
        case 'low':
          add(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hc, this.head, false);
          break;
        case 'bald':
          break;
      }
    }
    if (hat) {
      const lift = body.hair === 'afro' ? 0.04 : 0;
      const hcol = hat.color;
      switch (hat.style) {
        case 'cap':
          add(at(new THREE.SphereGeometry(0.36, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.08 + lift, 0], [1, 1, 1], [-0.12, 0, 0]), hcol, this.head);
          add(at(new THREE.CylinderGeometry(0.2, 0.2, 0.035, 12, 1, false, -Math.PI / 2, Math.PI), [0, 0.11 + lift, 0.26], [1.25, 1, 1.7], [0.12, 0, 0]), hcol, this.head);
          break;
        case 'fila':
          add(at(new THREE.CylinderGeometry(0.31, 0.35, 0.3, 14), [0.04, 0.27 + lift, 0], [1, 1, 1], [0, 0, -0.28]), hcol, this.head);
          break;
        case 'kufi':
          add(at(new THREE.CylinderGeometry(0.33, 0.35, 0.2, 14), [0, 0.22 + lift, 0]), hcol, this.head);
          break;
        case 'beanie':
          add(at(new THREE.SphereGeometry(0.36, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), [0, 0.1 + lift, 0]), hcol, this.head);
          add(at(new THREE.CylinderGeometry(0.37, 0.37, 0.09, 14), [0, 0.12 + lift, 0]), hat.accent ?? hcol, this.head);
          break;
        case 'headtie':
          add(at(new THREE.SphereGeometry(0.42, 14, 8), [0, 0.2 + lift, 0], [1.08, 0.72, 1.05]), hcol, this.head);
          add(at(new THREE.SphereGeometry(0.17, 8, 6), [0, 0.42 + lift, -0.16]), hat.accent ?? hcol, this.head);
          break;
      }
    }
    return parts;
  }

  /** Re-bakes the figure. Cheap enough for changing clothes, not for every frame. */
  private rebuild(): void {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.meshes = [];
    const parts = this.parts();
    const bodyGeo = bake(parts, this.boneIndex, this.rest, false);
    const hullGeo = bake(parts, this.boneIndex, this.rest, true);
    for (const p of parts) p.geo.dispose();

    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      // Bones live on the root, bound in the figure's own space (identity bind matrix).
      m.bind(this.skeleton, new THREE.Matrix4());
      m.raycast = () => {};
      m.boundingSphere = geo.boundingSphere!.clone();
      if (this.opts.xray) m.renderOrder = order;
      this.root.add(m);
      this.meshes.push(m);
      return m;
    };
    make(bodyGeo, this.material, 2);
    make(hullGeo, outlineMaterial(0.03), 2);
    // The ghost reuses the hull: same silhouette, no face details.
    if (this.opts.xray) make(hullGeo, ghost(), 1);
  }

  /** Tint the whole figure towards a colour (0 = none): a threat highlight, a hit flash. */
  glow(color: THREE.Color, amount: number): void {
    this.material.emissive.copy(color).multiplyScalar(Math.max(0, amount));
  }

  // ---------------------------------------------------------------- motion

  /**
   * speed: ground speed in m/s (0 when standing); air: off the ground. Blends between idle,
   * walk and run, and tucks into a jump pose in the air.
   */
  animate(dt: number, speed: number, air = false): void {
    this.t += dt;
    const k = 1 - Math.exp(-10 * dt);
    this.run += (Math.min(1, speed / 4) - this.run) * k;
    this.air += ((air ? 1 : 0) - this.air) * (1 - Math.exp(-14 * dt));
    // One full stride every 2.4 m, whatever the speed.
    this.phase += speed * dt * ((Math.PI * 2) / 2.4);
    const run = this.run * (1 - this.air);
    const amp = this.skirt ? 0.35 : 1;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const idle = 1 - this.run;
    const breathe = Math.sin(this.t * 2.2);

    this.hips.position.y = HIP_Y + Math.abs(c) * 0.06 * run - this.air * 0.04;
    this.chest.rotation.x = 0.13 * run + this.air * 0.08;
    this.chest.rotation.y = s * 0.14 * run;
    this.chest.scale.y = 1 + breathe * 0.012 * idle;
    this.head.rotation.y = Math.sin(this.t * 0.37) * 0.25 * idle - this.chest.rotation.y * 0.8;
    this.head.rotation.x = -this.chest.rotation.x * 0.6;

    for (const leg of this.legs) {
      const swing = s * leg.side * 0.75 * run * amp;
      leg.upper.rotation.x = swing - this.air * (leg.side > 0 ? 0.75 : 0.3);
      leg.lower.rotation.x = run * amp * (0.2 + 0.9 * Math.max(0, -c * leg.side)) + this.air * (leg.side > 0 ? 1.1 : 0.5);
      leg.end.rotation.x = -leg.lower.rotation.x * 0.3;
    }
    for (const arm of this.arms) {
      // Opposite arm to leg, so the left arm swings with the right leg.
      arm.upper.rotation.x = s * arm.side * -0.7 * run - this.air * 0.4 + Math.sin(this.t * 2.2 + arm.side) * 0.03 * idle;
      arm.upper.rotation.z = arm.side * (0.07 + 0.05 * run + this.air * 0.9 + breathe * 0.01 * idle);
      arm.lower.rotation.x = -(0.15 + 0.85 * run + this.air * 0.3);
    }
  }
}
