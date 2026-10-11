import '@fontsource/bungee';
import * as THREE from 'three';
import { Game } from './game';
import { Dialogue } from './dialogue';
import { Hud } from './hud';
import { Keyboard } from './input';
import { CameraRig, Intro, createCamera, fadeOccluders } from './scene/camera';
import { Birds } from './scene/birds';
import { Clouds } from './scene/clouds';
import { Npcs } from './scene/npcs';
import { Space } from './scene/space';
import { Rng } from './scene/rng';
import { PlayerAvatar } from './scene/player';
import { findPath } from './scene/pathfind';
import { chartOf, raySphere } from './scene/sphere';
import { Traffic } from './scene/traffic';
import { buildWorld, type Place } from './scene/world';

const INTERACT_RADIUS = 2.5;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app')!.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = createCamera();
const buildStart = performance.now();
const world = buildWorld(scene);
if (import.meta.env.DEV) console.info(`[9ja] world built in ${Math.round(performance.now() - buildStart)} ms`);
const { places } = world;

const game = new Game();
const player = new PlayerAvatar();
scene.add(player.root);
const keyboard = new Keyboard();

const placeById = (id: string) => places.find((p) => p.id === id)!;
/** Teleport, nudged out of anything solid so the player never starts inside a wall. */
const teleportTo = (point: THREE.Vector3) => {
  const p = point.clone();
  world.collisions.resolve(p);
  player.teleport(p.setLength(p.length() + world.heightAt(p)));
};
teleportTo(placeById(game.state.location).door);
const rig = new CameraRig(camera, player.ground);

const npcs = new Npcs(scene, world.npcSpots, document.getElementById('npc-tags')!);
let dialogue: Dialogue;
const hud = new Hud(
  game,
  () => teleportTo(placeById('office').door),
  (npc) => dialogue.open(npc),
);
dialogue = new Dialogue(game, (text) => hud.toast(text));
// E talks to whoever is closest.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || dialogue.isOpen || intro.active) return;
  const npc = npcs.nearest(player.ground);
  if (npc) dialogue.open(npc);
});
const isBusy = () => game.now().totalMinutes < game.state.busyUntil;

// Click or tap to move: ray against the planet surface.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const touches = new Map<number, { x: number; y: number }>();
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raySphere(raycaster.ray);
  // This runs before the pinch tracker below records the new pointer, so any pointer
  // already held means this is a second finger (pinch-zoom), not a move order.
  if (hit && !isBusy() && !intro.active && !dialogue.isOpen && touches.size === 0) {
    // Route round buildings and walls; fall back to walking straight if no route is found.
    player.followPath(findPath(world.collisions, player.ground, hit) ?? [hit]);
  }
});

// Track active touches so a second finger never issues a move order.
renderer.domElement.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
const endTouch = (e: PointerEvent) => touches.delete(e.pointerId);
renderer.domElement.addEventListener('pointerup', endTouch);
renderer.domElement.addEventListener('pointercancel', endTouch);

// Title screen: whole planet turning, then Begin flies down to the player.
const clouds = new Clouds(scene, new Rng(7));
const space = new Space(scene, new Rng(11));
const birds = new Birds(scene, new Rng(23));
// Go-slow corridors: the main road through the hub and city, and every third city street.
const busy = (e: (typeof world.roads.edges)[number]) => {
  const lambda = chartOf(e.pts[Math.floor(e.pts.length / 2)]!).lambda;
  return (e.kind === 'main' && lambda > -0.7 && lambda < 2.4) || (e.city && e.kind === 'street' && world.roads.edges.indexOf(e) % 3 === 0);
};
const traffic = new Traffic(scene, world.roads, new Rng(77), busy, [placeById('food_stall').door, placeById('bus_stop').door]);
const intro = new Intro();
const introEl = document.getElementById('intro')!;
const startGame = () => {
  intro.begin(camera);
  introEl.classList.add('leaving');
};
document.getElementById('begin')!.addEventListener('click', startGame);
window.addEventListener('keydown', (e) => {
  if (intro.active && (e.code === 'Enter' || e.code === 'Space')) startGame();
});
if (new URLSearchParams(location.search).has('skipIntro')) {
  intro.skip();
  introEl.remove();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function nearestPlace(): Place | null {
  let best: Place | null = null;
  let bestDist = INTERACT_RADIUS;
  const at = player.ground;
  for (const p of places) {
    const d = p.door.distanceTo(at);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

// Dev-only hook for automated checks and console debugging.
if (import.meta.env.DEV) Object.assign(window, { __9ja: { game, player, places, scene, renderer, camera, world, rig, THREE, teleportTo, intro, npcs, dialogue, traffic, findPath } });

const clock = new THREE.Clock();
const walk = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const playing = !intro.active;
  const busy = isBusy() || !playing || dialogue.isOpen;
  if (keyboard.consumeJump() && !busy) player.jump();

  // WASD is relative to the screen: W walks "up" the screen along the planet.
  const input = busy ? new THREE.Vector2() : keyboard.direction();
  walk.set(0, 0, 0).addScaledVector(rig.right, input.x).addScaledVector(rig.forward, -input.y);
  player.update(dt, walk, world.collisions, world.heightAt);
  player.push((p) => traffic.pushOut(p));

  const near = playing ? nearestPlace() : null;
  if (near && near.id !== game.state.location) game.dispatch({ type: 'enter', location: near.id });

  const ground = player.ground;
  if (playing) {
    rig.update(ground, dt);
    fadeOccluders(camera, ground, world.occluders, dt);
  } else intro.update(dt, camera, rig);
  clouds.update(dt, camera, playing ? ground : null);
  const nearNpc = playing ? npcs.nearest(ground) : null;
  // Walking away ends the conversation.
  if (dialogue.isOpen && !nearNpc) dialogue.close();
  npcs.update(clock.elapsedTime, dt, playing ? ground : null, camera, !dialogue.isOpen);
  world.update(dt);
  space.update(dt, camera);
  traffic.update(dt, playing ? player.ground : null, camera);
  birds.update(dt);

  // Lights ride with whatever we're looking at: the player in play, the planet's visible face on the title.
  const anchor = playing ? ground : camera.position.clone().setLength(ground.length());
  const up = anchor.clone().normalize();
  world.hemi.position.copy(up);
  world.sun.position.copy(anchor).addScaledVector(up, 30).addScaledVector(rig.right, 18).addScaledVector(rig.forward, 8);
  world.sun.target.position.copy(anchor);

  document.body.classList.toggle('playing', playing);
  document.body.classList.toggle('talking', dialogue.isOpen);
  if (playing) hud.update(near, nearNpc);
  renderer.render(scene, camera);
});
