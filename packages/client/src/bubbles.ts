import * as THREE from 'three';

interface Bubble {
  el: HTMLElement;
  /** Followed while the bubble shows (an agbero's live position). */
  at: THREE.Vector3;
  until: number;
}

/** Comic speech bubbles over people's heads, positioned on screen each frame. */
export class Bubbles {
  private list: Bubble[] = [];

  constructor(private root: HTMLElement) {}

  /** Shows text over the person at `at` (kept by reference, so it follows them). */
  say(at: THREE.Vector3, text: string, seconds = 2.6, tone: 'hostile' | 'calm' = 'hostile'): void {
    // One bubble per head: a new line replaces the old one.
    const old = this.list.find((b) => b.at === at);
    if (old) this.remove(old);
    const el = document.createElement('div');
    el.className = `bubble ${tone}`;
    el.textContent = text;
    this.root.append(el);
    this.list.push({ el, at, until: performance.now() + seconds * 1000 });
  }

  clear(): void {
    for (const b of [...this.list]) this.remove(b);
  }

  private remove(b: Bubble): void {
    b.el.remove();
    this.list.splice(this.list.indexOf(b), 1);
  }

  update(camera: THREE.Camera): void {
    const now = performance.now();
    for (const b of [...this.list]) {
      if (now > b.until) {
        this.remove(b);
        continue;
      }
      const up = b.at.clone().normalize();
      const head = b.at.clone().addScaledVector(up, 2.5);
      // Hidden round the far side of the planet.
      if (head.clone().sub(camera.position).dot(up) > 0) {
        b.el.style.display = 'none';
        continue;
      }
      head.project(camera);
      b.el.style.display = 'block';
      b.el.style.transform = `translate(-50%, -100%) translate(${((head.x + 1) / 2) * innerWidth}px, ${((1 - head.y) / 2) * innerHeight}px)`;
    }
  }
}
