import * as THREE from 'three';
import { R } from './sphere';

/*
 * Night lighting, faked for phones: no real light sources. Lamp heads and windows glow,
 * and light falls on the ground as additive pools. Nigeria's power supply is part of it:
 * whole patches go dark, some lamps are dead or flicker, some houses have no light.
 */

export type LampState = 'on' | 'off' | 'flicker';

export interface Lamp {
  /** Lamp head (world), and the matrix that places it. */
  head: THREE.Matrix4;
  /** Where its light lands, and the matrix that lays the pool there. */
  poolAt: THREE.Vector3;
  pool: THREE.Matrix4;
  /** Foot of the post, off the road: where loiterers gather. */
  base: THREE.Vector3;
  state: LampState;
  phase: number;
}

/** 0 by day, 1 at full night. Shared by every lit window. */
export const windowNight = { value: 0 };

let glowTex: THREE.CanvasTexture | null = null;
/** Soft round falloff, white in the middle to clear at the edge. */
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/**
 * A light pool lying on the planet: a subdivided plane w x l centred at (cx, cz) in local space,
 * curved down with the surface around the local origin so it hugs the ground everywhere.
 */
export function poolGeometry(w: number, l: number, cx = 0, cz = 0, lift = 0.07): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, l, 8, 8).rotateX(-Math.PI / 2).translate(cx, 0, cz);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, lift - (x * x + z * z) / (2 * R));
  }
  g.computeVertexNormals();
  return g;
}

/** Additive glow material: instance colour is the light's brightness (black = off). */
export function glowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

/** Flicker: mostly on, with stutters and the odd long drop-out, different for every lamp. */
export function flicker(t: number, phase: number): number {
  const stutter = Math.sin(t * 23 + phase) * Math.sin(t * 7.3 + phase * 2.1);
  const dropout = Math.sin(t * 0.7 + phase * 3.3) > 0.82;
  return dropout || stutter < -0.45 ? 0.08 : 1;
}

const _c = new THREE.Color();
const LIT = new THREE.Color(0xffe2a6);
const DEAD = new THREE.Color(0x4a4e50);
const SODIUM = new THREE.Color(0xffa94d);

/** Street lamps: glowing heads (one draw call) and their pools of light (one draw call). */
export class StreetLights {
  private heads: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;

  constructor(
    scene: THREE.Scene,
    readonly lamps: Lamp[],
  ) {
    const n = Math.max(1, lamps.length);
    this.heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.14, 0.34), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.pools = new THREE.InstancedMesh(poolGeometry(8, 8), glowMaterial(), n);
    lamps.forEach((l, i) => {
      this.heads.setMatrixAt(i, l.head);
      this.pools.setMatrixAt(i, l.pool);
      this.heads.setColorAt(i, DEAD);
      this.pools.setColorAt(i, _c.setRGB(0, 0, 0));
    });
    this.heads.count = this.pools.count = lamps.length;
    for (const m of [this.heads, this.pools]) {
      m.frustumCulled = false;
      m.raycast = () => {};
      scene.add(m);
    }
    this.pools.renderOrder = 4;
  }

  /** Brightness of a lamp right now (0 dead or off, 1 full). */
  private level(l: Lamp, t: number): number {
    return l.state === 'off' ? 0 : l.state === 'flicker' ? flicker(t, l.phase) : 1;
  }

  /** True if a working (or flickering) lamp lights this spot. */
  isLit(p: THREE.Vector3): boolean {
    return this.lamps.some((l) => l.state !== 'off' && l.poolAt.distanceToSquared(p) < 7.5 * 7.5);
  }

  update(t: number, night: number): void {
    this.lamps.forEach((l, i) => {
      const k = this.level(l, t) * night;
      this.heads.setColorAt(i, _c.copy(DEAD).lerp(LIT, k));
      this.pools.setColorAt(i, _c.copy(SODIUM).multiplyScalar(0.6 * k));
    });
    this.heads.instanceColor!.needsUpdate = true;
    this.pools.instanceColor!.needsUpdate = true;
    this.pools.visible = night > 0.02;
  }
}

const GLASS_A = new THREE.Color(0x46606e);
const GLASS_B = new THREE.Color(0x3e4c52);

/**
 * Lights a building's windows at night if it has power. Windows are found by their glass colour,
 * so no extra geometry or attributes are needed. tint: warm bulb or cold fluorescent.
 */
export function glowWindows(mat: THREE.MeshToonMaterial, powered: boolean, tint: THREE.ColorRepresentation): void {
  const uPowered = { value: powered ? 1 : 0 };
  const uTint = { value: new THREE.Color(tint) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = windowNight;
    shader.uniforms.uPowered = uPowered;
    shader.uniforms.uTint = uTint;
    shader.uniforms.uGlassA = { value: GLASS_A };
    shader.uniforms.uGlassB = { value: GLASS_B };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uPowered;\nuniform vec3 uTint;\nuniform vec3 uGlassA;\nuniform vec3 uGlassB;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef USE_COLOR
          float glass = max(step(distance(vColor.rgb, uGlassA), 0.01), step(distance(vColor.rgb, uGlassB), 0.01));
          totalEmissiveRadiance += uTint * glass * uNight * uPowered;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'windows';
}
