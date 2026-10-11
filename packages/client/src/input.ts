import * as THREE from 'three';

const DIRS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** WASD / arrow keys for movement (screen-relative: the camera never rotates), Space to jump. */
export class Keyboard {
  private held = new Set<string>();
  private jumpQueued = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code in DIRS || e.code === 'Space') e.preventDefault();
      if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    // Releasing keys while the tab is in the background would otherwise leave them stuck.
    window.addEventListener('blur', () => this.held.clear());
  }

  direction(): THREE.Vector2 {
    const v = new THREE.Vector2();
    for (const code of this.held) {
      const d = DIRS[code];
      if (d) v.add(new THREE.Vector2(d[0], d[1]));
    }
    return v;
  }

  /** True once per Space press. */
  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }
}
