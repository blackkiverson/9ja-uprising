import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Kit, box, cyl } from './kit';
import type { Rng } from './rng';
import type { Frame } from './sphere';

const CELLS = 4; // atlas is 4 x 4 sign faces
const SIZE = 1024;
const CELL = SIZE / CELLS;

type Draw = (g: CanvasRenderingContext2D, font: string) => void;

const text = (g: CanvasRenderingContext2D, font: string, lines: string[], color: string, bg: string, size = 44) => {
  g.fillStyle = bg;
  g.fillRect(0, 0, CELL, CELL * 0.62);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    let s = size;
    g.font = `${s}px ${font}`;
    while (g.measureText(l).width > CELL * 0.88 && s > 14) g.font = `${(s -= 2)}px ${font}`;
    g.fillText(l, CELL / 2, (CELL * 0.62 * (i + 1)) / (lines.length + 1));
  });
};

const arrow = (g: CanvasRenderingContext2D, dir: 1 | -1) => {
  g.fillStyle = '#eef0e6';
  g.fillRect(0, 0, CELL, CELL * 0.62);
  g.fillStyle = '#283130';
  g.save();
  g.translate(CELL / 2, CELL * 0.31);
  g.scale(dir, 1);
  g.beginPath();
  g.moveTo(-80, 0);
  g.lineTo(-20, -50);
  g.lineTo(-20, -22);
  g.lineTo(80, -22);
  g.lineTo(80, 22);
  g.lineTo(-20, 22);
  g.lineTo(-20, 50);
  g.closePath();
  g.fill();
  g.restore();
};

/** Made-up blocky glyphs, like the unreadable signs in the reference. */
const glyphs = (seed: number) => (g: CanvasRenderingContext2D) => {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#e4e7dc';
  g.fillRect(0, 0, CELL, CELL * 0.62);
  g.fillStyle = '#283130';
  const n = 3 + Math.floor(rnd() * 3);
  const gw = 34;
  const x0 = (CELL - n * (gw + 8)) / 2;
  for (let c = 0; c < n; c++) {
    for (let j = 0; j < 5; j++) {
      const x = x0 + c * (gw + 8) + Math.floor(rnd() * 3) * 11;
      const y = 50 + Math.floor(rnd() * 5) * 11;
      g.fillRect(x, y, rnd() < 0.5 ? 22 : 9, rnd() < 0.5 ? 9 : 22);
    }
  }
  g.fillStyle = '#d9b44a';
  for (let i = 0; i < 3; i++) g.fillRect(CELL / 2 - 30 + i * 22, 125, 12, 12);
};

const FACES: Draw[] = [
  (g) => arrow(g, -1),
  (g) => arrow(g, 1),
  (g, f) => text(g, f, ['NO PARKING'], '#eef0e6', '#b5564c'),
  (g, f) => text(g, f, ['SLOW DOWN'], '#283130', '#d9b44a'),
  (g, f) => text(g, f, ['POST NO BILL'], '#283130', '#eef0e6'),
  (g, f) => text(g, f, ['THIS HOUSE IS', 'NOT FOR SALE'], '#a2483f', '#e9ecdf', 34),
  (g, f) => text(g, f, ['BEWARE OF 419'], '#eef0e6', '#283130'),
  (g, f) => text(g, f, ['SURULERE'], '#eef0e6', '#4f8f5a'),
  (g, f) => text(g, f, ['OJUELEGBA', '→'], '#eef0e6', '#4f8f5a', 38),
  (g, f) => text(g, f, ["GOD'S OWN", 'PROVISIONS'], '#283130', '#e3c24a', 34),
  (g, f) => text(g, f, ['HOT AMALA', '& EWEDU'], '#eef0e6', '#b5564c', 36),
  (g, f) => text(g, f, ['DANGER!', 'NO SWIMMING'], '#eef0e6', '#b5564c', 36),
  glyphs(11),
  glyphs(29),
  glyphs(53),
  (g, f) => {
    text(g, f, ['', 'MERCY', 'CLINIC'], '#a2483f', '#f1f3ec', 40);
    g.fillStyle = '#c0453c';
    g.fillRect(CELL / 2 - 13, 14, 26, 62);
    g.fillRect(CELL / 2 - 31, 32, 62, 26);
  },
];
export const SIGN_COUNT = FACES.length;
export const SIGN = { left: 0, right: 1, noParking: 2, slow: 3, postNoBill: 4, notForSale: 5, beware419: 6, surulere: 7, ojuelegba: 8, provisions: 9, amala: 10, noSwimming: 11, clinic: 15 } as const;

function drawAtlas(c: HTMLCanvasElement, font: string): void {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, SIZE, SIZE);
  FACES.forEach((draw, i) => {
    g.save();
    g.translate((i % CELLS) * CELL, Math.floor(i / CELLS) * CELL);
    draw(g, font);
    g.strokeStyle = '#283130';
    g.lineWidth = 8;
    g.strokeRect(4, 4, CELL - 8, CELL * 0.62 - 8);
    g.restore();
  });
}

/** Builds the sign atlas; redraws in Bungee once the font has loaded. */
function atlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  drawAtlas(c, '"Arial Black", system-ui, sans-serif');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  document.fonts?.load('48px Bungee').then(() => {
    drawAtlas(c, 'Bungee, sans-serif');
    tex.needsUpdate = true;
  });
  return tex;
}

/** Collects sign faces (one draw call) and their posts (added to the static props by the caller). */
export class Signs {
  private faces: THREE.BufferGeometry[] = [];

  /** A road sign on a post: f faces +z (towards the reader). */
  sign(f: Frame, face: number, posts: (k: Kit, f: Frame) => void, wide = false): void {
    // Big enough to read from the game camera, ~35 m away.
    const w = wide ? 3.3 : 2.3;
    const h = w * 0.62;
    const y = 2.4 + h / 2;
    const k = new Kit();
    k.add(cyl(0.08, 0.08, y, 6), 0x6b6f6c, [-(w / 2 - 0.2), y / 2, -0.07]);
    if (wide) k.add(cyl(0.08, 0.08, y, 6), 0x6b6f6c, [w / 2 - 0.2, y / 2, -0.07]);
    k.add(box(w + 0.12, h + 0.12, 0.1), 0x8a8f8c, [0, y, -0.07]);
    posts(k, f);
    this.face(f.matrix(0, y, 0), face, w, h);
  }

  /** Text painted straight onto a wall (matrix places a plane facing +z). */
  painted(matrix: THREE.Matrix4, face: number, w: number): void {
    this.face(matrix, face, w, w * 0.62);
  }

  private face(matrix: THREE.Matrix4, face: number, w: number, h: number): void {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv!;
    const cx = face % CELLS;
    const cy = Math.floor(face / CELLS);
    for (let i = 0; i < uv.count; i++) {
      const u = (cx + uv.getX(i)) / CELLS;
      const v = 1 - (cy + (1 - uv.getY(i)) * 0.62) / CELLS;
      uv.setXY(i, u, v);
    }
    g.translate(0, 0, 0.01);
    g.applyMatrix4(matrix);
    this.faces.push(g);
  }

  addTo(scene: THREE.Scene, rng: Rng): void {
    void rng;
    if (!this.faces.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(this.faces, false)!, new THREE.MeshBasicMaterial({ map: atlas(), side: THREE.FrontSide }));
    mesh.raycast = () => {};
    scene.add(mesh);
  }
}
