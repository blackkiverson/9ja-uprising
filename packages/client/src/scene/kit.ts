import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Frame } from './sphere';

type Vec3 = [number, number, number];

interface PartOptions {
  rot?: Vec3;
  scale?: Vec3;
  /** Recompute flat normals, for faceted shapes like hipped roofs. */
  flat?: boolean;
  /** Colour per triangle (cycled), e.g. mismatched roof sheets; overrides the part colour. */
  faceColors?: THREE.ColorRepresentation[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Builds one merged, vertex-coloured geometry from many simple parts.
 * One building or one prop group = one draw call, which keeps mid-range phones happy.
 */
export class Kit {
  readonly parts: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: Vec3, opts: PartOptions = {}): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (opts.flat) g.computeVertexNormals();
    _e.set(...(opts.rot ?? [0, 0, 0]));
    _m.compose(new THREE.Vector3(...pos), _q.setFromEuler(_e), new THREE.Vector3(...(opts.scale ?? [1, 1, 1])));
    g.applyMatrix4(_m);

    const c = new THREE.Color(color);
    const count = g.attributes.position!.count;
    const colors = new Float32Array(count * 3);
    const faces = opts.faceColors?.map((fc) => new THREE.Color(fc));
    for (let i = 0; i < count; i++) {
      const cc = faces ? faces[Math.floor(i / 3) % faces.length]! : c;
      colors.set([cc.r, cc.g, cc.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.parts.push(g);
    return this;
  }

  /** Copies another kit's parts in, placed and turned about Y. */
  addKit(kit: Kit, pos: Vec3, rotY = 0): this {
    _m.compose(new THREE.Vector3(...pos), _q.setFromAxisAngle(UP, rotY), new THREE.Vector3(1, 1, 1));
    for (const p of kit.parts) this.parts.push(p.clone().applyMatrix4(_m));
    return this;
  }

  /**
   * Merges the kit and bends it onto the planet around a frame, so long walls and
   * wide buildings sit flush on the curve. Also returns the flat (pre-bend) local bounds.
   */
  bend(frame: Frame): { geometry: THREE.BufferGeometry; bounds: THREE.Box3 } {
    const g = this.build();
    g.computeBoundingBox();
    const bounds = g.boundingBox!.clone();
    const pos = g.attributes.position!;
    const nor = g.attributes.normal!;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      frame.toWorld(pos.getX(i), pos.getY(i), pos.getZ(i), v);
      pos.setXYZ(i, v.x, v.y, v.z);
      frame.dirToWorld(nor.getX(i), nor.getY(i), nor.getZ(i), v);
      nor.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return { geometry: g, bounds };
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('Kit could not merge its parts');
    return merged;
  }
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (top: number, bottom: number, h: number, segments = 8) =>
  new THREE.CylinderGeometry(top, bottom, h, segments);

// Square pyramid with a 1 x 1 base, centred: scale it to make a hipped zinc roof.
const PYRAMID = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
export const pyramid = () => PYRAMID;
