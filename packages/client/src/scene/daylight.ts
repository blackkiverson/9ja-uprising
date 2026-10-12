import * as THREE from 'three';
import { MINUTES_PER_DAY } from '@9ja/shared';

interface Key {
  at: number; // minute of the day
  sky: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunI: number;
  /** Space around the planet takes the time's colour: rocks, specks (stars at night), haze. */
  rock: number;
  speck: number;
  haze: number;
  /** How strongly lamps, windows and headlights shine (0 by day, 1 at night). */
  lamps: number;
}

// Pastel, Messenger-palette lighting through the day: dawn peach, teal day, orange evening,
// violet dusk, deep blue night. Night stays readable rather than realistically dark.
const KEYS: Key[] = [
  { at: 0, sky: 0x1c2a44, hemiSky: 0x7088bd, hemiGround: 0x1f2c3c, hemi: 0.6, sun: 0xa9bce8, sunI: 0.35, rock: 0x34507e, speck: 0xd4e2ff, haze: 0x2c3f66, lamps: 1 },
  { at: 300, sky: 0x1c2a44, hemiSky: 0x7088bd, hemiGround: 0x1f2c3c, hemi: 0.6, sun: 0xa9bce8, sunI: 0.35, rock: 0x34507e, speck: 0xd4e2ff, haze: 0x2c3f66, lamps: 1 },
  { at: 360, sky: 0xdb9c80, hemiSky: 0xf2c6a6, hemiGround: 0x5a6676, hemi: 0.95, sun: 0xffb685, sunI: 0.7, rock: 0xd09a86, speck: 0xf2c4ac, haze: 0xd8a48e, lamps: 0.45 },
  { at: 450, sky: 0x76b6b1, hemiSky: 0xf3f1e4, hemiGround: 0x5f8f8a, hemi: 1.3, sun: 0xfff6e8, sunI: 1.4, rock: 0x8fcac3, speck: 0xa6dcd4, haze: 0x8fd0c6, lamps: 0 },
  { at: 1020, sky: 0x76b6b1, hemiSky: 0xf3f1e4, hemiGround: 0x5f8f8a, hemi: 1.3, sun: 0xfff6e8, sunI: 1.4, rock: 0x8fcac3, speck: 0xa6dcd4, haze: 0x8fd0c6, lamps: 0 },
  { at: 1110, sky: 0xe48d63, hemiSky: 0xf6c49c, hemiGround: 0x6a5a68, hemi: 1.05, sun: 0xff9a58, sunI: 1.1, rock: 0xffc597, speck: 0xffe2bc, haze: 0xf2ae86, lamps: 0.2 },
  { at: 1185, sky: 0x47406e, hemiSky: 0x9a8fc8, hemiGround: 0x2c2c44, hemi: 0.85, sun: 0xc0a6e0, sunI: 0.55, rock: 0x6c5c96, speck: 0xc8b8f0, haze: 0x5a4e84, lamps: 0.8 },
  { at: 1260, sky: 0x1c2a44, hemiSky: 0x7088bd, hemiGround: 0x1f2c3c, hemi: 0.6, sun: 0xa9bce8, sunI: 0.35, rock: 0x34507e, speck: 0xd4e2ff, haze: 0x2c3f66, lamps: 1 },
];

/**
 * How much the sky changes around a minute of the day: 1 through dawn and dusk, low through the
 * flat stretches of full day and full night. A time-lapse spends its seconds by this, so a sleep
 * doesn't race the whole sunrise past in its last moment.
 */
export function skyChange(minute: number): number {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  let i = KEYS.length - 1;
  while (KEYS[i]!.at > m) i--;
  const a = KEYS[i]!;
  const b = KEYS[(i + 1) % KEYS.length]!;
  return a.sky === b.sky && a.lamps === b.lamps ? 0.15 : 1;
}

const _a = new THREE.Color();
const _b = new THREE.Color();
const mix = (out: THREE.Color, a: number, b: number, t: number) => out.copy(_a.setHex(a)).lerp(_b.setHex(b), t);

/** Sky colour, sun and fill light for a minute of the day. The sun (or moon) arcs over the player. */
export class Daylight {
  readonly sky = new THREE.Color();
  readonly rock = new THREE.Color();
  readonly speck = new THREE.Color();
  readonly haze = new THREE.Color();
  lamps = 0;

  constructor(
    private scene: THREE.Scene,
    private hemi: THREE.HemisphereLight,
    private sun: THREE.DirectionalLight,
  ) {
    scene.background = this.sky;
  }

  /** minute: fractional minute of the day. anchor: what we're looking at; right/forward: screen axes there. */
  update(minute: number, anchor: THREE.Vector3, right: THREE.Vector3, forward: THREE.Vector3): void {
    const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    let i = KEYS.length - 1;
    while (KEYS[i]!.at > m) i--;
    const k0 = KEYS[i]!;
    const k1 = KEYS[(i + 1) % KEYS.length]!;
    const span = (k1.at - k0.at + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
    const t = ((m - k0.at + MINUTES_PER_DAY) % MINUTES_PER_DAY) / span;

    mix(this.sky, k0.sky, k1.sky, t);
    this.scene.background = this.sky;
    mix(this.hemi.color, k0.hemiSky, k1.hemiSky, t);
    mix(this.hemi.groundColor, k0.hemiGround, k1.hemiGround, t);
    this.hemi.intensity = THREE.MathUtils.lerp(k0.hemi, k1.hemi, t);
    mix(this.sun.color, k0.sun, k1.sun, t);
    this.sun.intensity = THREE.MathUtils.lerp(k0.sunI, k1.sunI, t);
    mix(this.rock, k0.rock, k1.rock, t);
    mix(this.speck, k0.speck, k1.speck, t);
    mix(this.haze, k0.haze, k1.haze, t);
    this.lamps = THREE.MathUtils.lerp(k0.lamps, k1.lamps, t);

    // Rises on the right of the screen at 06:00, overhead at noon, sets on the left at 18:00; the
    // moon carries on the same way overnight, so the light never jumps.
    const theta = ((m - 360) / 720) * Math.PI;
    const up = anchor.clone().normalize();
    const dir = right.clone().multiplyScalar(Math.cos(theta)).addScaledVector(up, Math.max(Math.abs(Math.sin(theta)), 0.22)).addScaledVector(forward, 0.27).normalize();
    this.hemi.position.copy(up);
    this.sun.position.copy(anchor).addScaledVector(dir, 34);
    this.sun.target.position.copy(anchor);
  }
}
