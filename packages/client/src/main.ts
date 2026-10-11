import * as THREE from 'three';
import { Game } from './game';
import { Hud } from './hud';
import { createCamera, fadeOccluders, followTarget } from './scene/camera';
import { PlayerAvatar } from './scene/player';
import { buildWorld, type Place } from './scene/world';

const INTERACT_RADIUS = 2.5;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app')!.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = createCamera();
const { ground, places } = buildWorld(scene);

const game = new Game();
const player = new PlayerAvatar();
scene.add(player.root);

const placeById = (id: string) => places.find((p) => p.id === id)!;
player.teleport(placeById(game.state.location).door);

const hud = new Hud(game, () => player.teleport(placeById('office').door));

// Click or tap to move.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(ground)[0];
  if (hit && game.now().totalMinutes >= game.state.busyUntil) player.moveTo(hit.point);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function nearestPlace(): Place | null {
  let best: Place | null = null;
  let bestDist = INTERACT_RADIUS;
  for (const p of places) {
    const d = p.door.distanceTo(player.root.position);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

camera.position.copy(player.root.position).add(new THREE.Vector3(0, 26, 18));

// Dev-only hook for automated checks and console debugging.
if (import.meta.env.DEV) Object.assign(window, { __9ja: { game, player, places } });
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  player.update(dt);

  const near = nearestPlace();
  if (near && near.id !== game.state.location) game.dispatch({ type: 'enter', location: near.id });

  followTarget(camera, player.root.position, dt);
  fadeOccluders(camera, player.root.position, scene);
  hud.update(near);
  renderer.render(scene, camera);
});
