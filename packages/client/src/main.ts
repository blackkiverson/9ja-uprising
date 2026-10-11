import '@fontsource/bungee';
import * as THREE from 'three';
import { AGBERO, AGBERO_LINES, CLINIC, DANFO_ROUTES, KNOCKOUT, agberosSettled, formatClock } from '@9ja/shared';
import { Bubbles } from './bubbles';
import { Tips, type TipId } from './tips';
import { Game } from './game';
import { Music } from './audio/music';
import { Dialogue } from './dialogue';
import { Hud } from './hud';
import { Keyboard } from './input';
import { CameraRig, Intro, LapseCam, createCamera, fadeOccluders } from './scene/camera';
import { Birds } from './scene/birds';
import { Clouds } from './scene/clouds';
import { Collisions } from './scene/collision';
import { Daylight } from './scene/daylight';
import { DanfoRide } from './scene/ride';
import { windowNight } from './scene/nightlights';
import { Npcs } from './scene/npcs';
import { Smoke } from './scene/smoke';
import { Space } from './scene/space';
import { Rng } from './scene/rng';
import { PlayerAvatar } from './scene/player';
import { MoveMarker } from './scene/markers';
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
  (to) => boardDanfo(to),
  (npc) => dialogue.open(npc),
  (minutes) => startLapse(minutes),
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
const moveMarker = new MoveMarker(scene);
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
    moveMarker.show(hit.clone().setLength(hit.length() + world.heightAt(hit)));
  }
});

// Track active touches so a second finger never issues a move order.
renderer.domElement.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
const endTouch = (e: PointerEvent) => touches.delete(e.pointerId);
renderer.domElement.addEventListener('pointerup', endTouch);
renderer.domElement.addEventListener('pointercancel', endTouch);

// Soundtrack: starts on the first tap or key press (browsers block audio before that).
const music = new Music();
const soundBtn = document.getElementById('sound')!;
const nowPlaying = document.getElementById('now-playing')!;
let nowTimer = 0;
music.onTrack = (title) => {
  nowPlaying.textContent = `♪ ${title}`;
  nowPlaying.classList.add('show');
  clearTimeout(nowTimer);
  nowTimer = window.setTimeout(() => nowPlaying.classList.remove('show'), 4000);
};
soundBtn.classList.toggle('muted', music.muted);
// Try straight away; if the browser blocks autoplay, the first tap or key press starts it.
music.start();
const startMusic = () => music.start();
window.addEventListener('pointerdown', startMusic);
window.addEventListener('keydown', startMusic);
soundBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  music.start();
  music.toggleMute();
  soundBtn.classList.toggle('muted', music.muted);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    music.toggleMute();
    soundBtn.classList.toggle('muted', music.muted);
  }
});

// Title screen: whole planet turning, then Begin flies down to the player.
const clouds = new Clouds(scene, new Rng(7));
const space = new Space(scene, new Rng(11));
const birds = new Birds(scene, new Rng(23));
// Go-slow corridors: the main road through the hub and city, and every third city street.
const busy = (e: (typeof world.roads.edges)[number]) => {
  const lambda = chartOf(e.pts[Math.floor(e.pts.length / 2)]!).lambda;
  return (e.kind === 'main' && lambda > -0.7 && lambda < 2.4) || (e.city && e.kind === 'street' && world.roads.edges.indexOf(e) % 3 === 0);
};
const smoke = new Smoke(scene);
for (const s of world.smokeSpots) smoke.addSource(s.p, s.kind);
// At night agberos gather at the dead lamps in unsafe patches (a few at lit corners too).
const lampRng = new Rng(91);
const deadLamps = world.lights.lamps.filter((l) => l.state === 'off');
const litLamps = world.lights.lamps.filter((l) => l.state === 'on');
const traffic = new Traffic(scene, world.roads, new Rng(77), busy, [placeById('food_stall').door, placeById('bus_stop').door, placeById('market').door], {
  isLit: (p) => world.lights.isLit(p),
  dark: deadLamps.filter(() => lampRng.chance(0.7)).map((l) => l.base),
  lit: litLamps.filter(() => lampRng.chance(0.2)).map((l) => l.base),
});
const intro = new Intro();
const introEl = document.getElementById('intro')!;
const startGame = () => {
  intro.begin(camera);
  introEl.classList.remove('back');
  introEl.classList.add('leaving');
};
// Exit: back to the turning planet and the Begin button. Progress is saved after every action.
document.getElementById('exit')!.addEventListener('click', (e) => {
  e.stopPropagation();
  if (intro.active) return;
  dialogue.close();
  player.followPath([]);
  intro.exit(camera);
  if (!document.body.contains(introEl)) document.body.append(introEl);
  introEl.classList.remove('leaving');
  introEl.classList.add('back');
});
document.getElementById('begin')!.addEventListener('click', startGame);
window.addEventListener('keydown', (e) => {
  if (intro.active && (e.code === 'Enter' || e.code === 'Space')) startGame();
});
// ?time=07:00 jumps the personal clock forward to that time, then drops the parameter so a
// reload doesn't skip another day.
{
  const params = new URLSearchParams(location.search);
  const m = /^(\d{1,2}):?(\d{2})?$/.exec(params.get('time') ?? '');
  if (m && Number(m[1]) < 24) {
    game.skipTo(Number(m[1]) * 60 + Number(m[2] ?? 0));
    params.delete('time');
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  }
}
if (new URLSearchParams(location.search).has('skipIntro')) {
  intro.skip();
  introEl.classList.add('leaving');
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
if (import.meta.env.DEV) Object.assign(window, { __9ja: { game, player, places, scene, renderer, camera, world, rig, THREE, teleportTo, intro, npcs, dialogue, traffic, findPath, music, smoke } });

const daylight = new Daylight(scene, world.hemi, world.sun);

// --- Danfo rides: board, wait for it to fill up, then ride the streets to the stop. ---
const ride = new DanfoRide(scene, world.roads);
let rideTo: Place['id'] | null = null;
function boardDanfo(to: Place['id']): void {
  const door = placeById(to).door;
  player.followPath([]);
  if (!ride.start(player.ground, door)) {
    teleportTo(door); // no road there: just arrive
    return;
  }
  rideTo = to;
  player.root.visible = false;
  const name = DANFO_ROUTES[to]?.name ?? to;
  hud.toast(`Conductor: "${name}! ${name}! Enter with your change o!"`);
}
function endRide(): void {
  if (!rideTo) return;
  ride.stop();
  player.root.visible = true;
  teleportTo(placeById(rideTo).door);
  rig.update(player.ground, 0, true);
  rideTo = null;
}

// --- Time-lapse: skipping time (fast-forward, sleep) races the sky through the hours skipped. ---
// Timed on the real clock, not the frame delta (which is capped), so a slow frame can't drag it out.
let lapse: { from: number; to: number; t: number; dur: number; start: number } | null = null;
const lapseCam = new LapseCam();
function startLapse(minutes: number): void {
  const to = game.exactNow();
  // Long enough to pull out, spin the planet and dive back in.
  lapse = { from: to - minutes, to, t: 0, dur: THREE.MathUtils.clamp(3.6 + minutes / 160, 4.5, 7.5), start: performance.now() };
  player.followPath([]);
  lapseCam.start(camera, rig);
}
/** 0 to 1 and back over the lapse: how hard the world is racing right now. */
const lapseRush = () => (lapse ? Math.sin(Math.PI * Math.min(1, lapse.t / lapse.dur)) : 0);
const shownMinute = () => {
  if (!lapse) return game.exactNow();
  const t = Math.min(1, lapse.t / lapse.dur);
  return THREE.MathUtils.lerp(lapse.from, lapse.to, t * t * (3 - 2 * t));
};

// --- At work: the office goes see-through and the player walks about inside until the shift ends. ---
const office = world.interiors.office;
const noWalls = new Collisions();
let inOffice = false;
let deskPause = 0;
const atWork = () => game.state.busyWith === 'work' && game.state.location === 'office' && isBusy();

// --- Recovering at the clinic: you're inside (hidden), the building glows in and out, and a
// pie over it fills until you're discharged. ---
const clinic = world.interiors.clinic;
const clinicMat = clinic.mesh.material as THREE.MeshToonMaterial;
const pieEl = document.getElementById('clinic-pie')!;
const pieFill = pieEl.querySelector('.pie') as HTMLElement;
const pieLabel = pieEl.querySelector('span')!;
let clinicStay: { from: number; until: number } | null = null;
const recovering = () => (game.state.busyWith === 'recovering' || game.state.busyWith === 'treatment') && game.state.location === 'clinic' && isBusy();
function updateClinic(playing: boolean, minute: number, t: number): void {
  if (playing && recovering()) {
    const minutes = game.state.busyWith === 'recovering' ? KNOCKOUT.minutes : CLINIC.full.minutes;
    clinicStay ??= { from: game.state.busyUntil - minutes, until: game.state.busyUntil };
  } else if (clinicStay && !lapse) clinicStay = null; // hold through a skip's time-lapse, then out
  const k = clinicStay ? 0.5 + 0.5 * Math.sin(t * 3) : 0;
  clinicMat.emissive.setRGB(0.5 * k, 0.42 * k, 0.36 * k);
  if (!clinicStay || !playing) {
    pieEl.hidden = true;
    return;
  }
  const p = THREE.MathUtils.clamp((minute - clinicStay.from) / (clinicStay.until - clinicStay.from), 0, 1);
  pieFill.style.setProperty('--p', p.toFixed(3));
  pieLabel.textContent = p >= 1 ? 'Ready!' : `Ready at ${formatClock(((clinicStay.until % 1440) + 1440) % 1440)}`;
  const top = clinic.frame.toWorld(0, 7.2, 0); // just above the roof
  const up = top.clone().normalize();
  if (top.clone().sub(camera.position).dot(up) > 0) {
    pieEl.hidden = true;
    return;
  }
  top.project(camera);
  pieEl.hidden = false;
  // Kept on screen (the camera looks down, so the roof can sit near the top edge).
  const y = THREE.MathUtils.clamp(((1 - top.y) / 2) * innerHeight, 185, innerHeight - 140);
  pieEl.style.transform = `translate(-50%, -100%) translate(${((top.x + 1) / 2) * innerWidth}px, ${y}px)`;
}

const clock = new THREE.Clock();
const walk = new THREE.Vector3();
let hitCooldown = 0;
let hurtTimer = 0;

/** A vehicle struck the player: damage through the shared rules, a hop, a red flash. */
const onStruck = (vehicle: 'car' | 'danfo' | 'keke', speed: number) => {
  const r = game.dispatch({ type: 'hit_by_vehicle', vehicle, speed });
  if (!r.ok) return;
  hitCooldown = 1.2;
  player.followPath([]);
  player.jump();
  hud.toast(r.message);
  hurt(r.knockedOut === true);
  tips.trigger('traffic');
};

/** Red flash and health-bar shake; a knockout wakes you at the clinic. */
function hurt(knockedOut: boolean): void {
  document.body.classList.remove('hurt');
  void document.body.offsetWidth; // restart the flash animation
  document.body.classList.add('hurt');
  clearTimeout(hurtTimer);
  hurtTimer = window.setTimeout(() => document.body.classList.remove('hurt'), 700);
  if (knockedOut) {
    dialogue.close();
    bubbles.clear();
    teleportTo(placeById('clinic').door);
    rig.update(player.ground, 0, true);
  }
}

// --- Agberos: they close in after dark, shout, and rough you up if you hang about without
// settling them. Settling (₦500) buys peace till morning. Running works: they're slower. ---
const bubbles = new Bubbles(document.getElementById('bubbles')!);
const tips = new Tips(document.getElementById('tip')!);
const PLACE_TIPS: Partial<Record<Place['id'], TipId>> = { bus_stop: 'danfo', market: 'danfo', office: 'work', food_stall: 'food', home: 'sleep', clinic: 'clinic' };
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;
let gripTime = 0;
let nextShout = 0;
let roughCooldown = 0;
let harassed = false;
function settleAgberos(): void {
  const r = game.dispatch({ type: 'settle_agberos' });
  if (!r.ok) {
    hud.toast(r.reason);
    return;
  }
  hud.loss('money', AGBERO.settle, 'Settled the agberos');
  const nearest = traffic.agberosNear(player.ground, 4)[0];
  if (nearest) bubbles.say(nearest, pick(AGBERO_LINES.settled), 2.6, 'calm');
  gripTime = 0;
}
function updateAgberos(dt: number, active: boolean): void {
  for (const e of traffic.takeEvents()) if (active) bubbles.say(e.at.clone(), pick(AGBERO_LINES.gaveUp), 2.2);
  const grip = active ? traffic.agberosNear(player.ground, 1.9) : [];
  const closing = active ? traffic.agberosNear(player.ground, 9) : [];
  harassed = grip.length > 0;
  nextShout -= dt;
  roughCooldown -= dt;
  if (closing.length) tips.trigger('agbero');
  if (closing.length && nextShout <= 0) {
    bubbles.say(pick(closing), pick(harassed ? AGBERO_LINES.grip : AGBERO_LINES.approach));
    nextShout = 1.6 + Math.random() * 1.4;
  }
  // Too close and not paying: within a second or two they either shove you to the ground
  // (health) or go through your pockets (money).
  gripTime = harassed ? gripTime + dt : Math.max(0, gripTime - dt * 2);
  if (gripTime > 1.5 && roughCooldown <= 0) {
    const kind = Math.random() < 0.5 ? 'push' : 'rob';
    const before = { health: game.state.health, money: game.state.money };
    const r = game.dispatch({ type: 'agbero_rough_up', kind });
    if (r.ok) {
      // A robbery with empty pockets turns into a shove, so judge by what actually happened.
      const pushed = r.knockedOut === true || r.state.health < before.health;
      bubbles.say(grip[0]!, pick(pushed ? AGBERO_LINES.push : AGBERO_LINES.rob), 2.4);
      if (r.knockedOut) hud.toast(r.message);
      else if (pushed) hud.loss('health', before.health - r.state.health, 'Pushed down by agberos');
      else hud.loss('money', before.money - r.state.money, 'Robbed by agberos');
      if (pushed) {
        player.knockDown();
        hurt(r.knockedOut === true);
      } else player.followPath([]);
    }
    gripTime = 0;
    roughCooldown = 3.5;
  }
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const playing = !intro.active;
  if (lapse && (lapse.t = (performance.now() - lapse.start) / 1000) >= lapse.dur) {
    lapse = null;
    lapseCam.active = false;
    rig.update(player.ground, 0, true);
  }
  // While the time-lapse camera is out at the planet, everything visible keeps living.
  const cinematic = lapseCam.active;
  const busy = isBusy() || !playing || dialogue.isOpen || lapse !== null;
  if (keyboard.consumeJump() && !busy) player.jump();

  // WASD is relative to the screen: W walks "up" the screen along the planet.
  const input = busy ? new THREE.Vector2() : keyboard.direction();
  walk.set(0, 0, 0).addScaledVector(rig.right, input.x).addScaledVector(rig.forward, -input.y);
  // Keep strolling round the office through the time-lapse; walk out of the door once it ends.
  const working = playing && (atWork() || (inOffice && lapse !== null));
  if (working) {
    inOffice = true;
    deskPause -= dt;
    if (player.idle && deskPause <= 0) {
      const lx = (Math.random() - 0.5) * (office.w - 2.4);
      const lz = (Math.random() - 0.5) * (office.d - 2.4);
      player.moveTo(office.frame.toWorld(lx, 0, lz));
      deskPause = 1 + Math.random() * 2.5;
    }
  } else if (inOffice) {
    inOffice = false;
    player.followPath([]);
    teleportTo(placeById('office').door);
  }
  player.update(dt, walk, inOffice ? noWalls : world.collisions, world.heightAt);
  // On the danfo: the player rides inside it. Skipping the ride (no longer busy) ends it at once;
  // arriving early catches the clock up to the fare's ride time.
  if (rideTo) {
    if (!isBusy()) endRide();
    else if (ride.update(dt, ride.boarding ? null : traffic.gapAhead(ride.position, ride.heading))) {
      game.dispatch({ type: 'arrive' });
      hud.toast('Owa o! You have arrived.');
      endRide();
    } else player.teleport(ride.position);
  }
  hitCooldown = Math.max(0, hitCooldown - dt);
  const struck = rideTo || clinicStay ? null : player.push((p) => {
    const hit = traffic.pushOut(p);
    // Thrown clear, but never into a wall.
    if (hit) world.collisions.resolve(p);
    return hit;
  });
  if (struck && playing && hitCooldown === 0) onStruck(struck.vehicle, struck.speed);

  const near = playing ? nearestPlace() : null;
  if (near && near.id !== game.state.location) game.dispatch({ type: 'enter', location: near.id });

  const ground = player.ground;
  if (playing && cinematic && lapse) lapseCam.update(lapse.t, lapse.dur, camera, rig, ground);
  else if (playing) {
    rig.update(ground, dt);
    fadeOccluders(camera, ground, world.occluders, dt, inOffice ? office.mesh : null);
  } else intro.update(dt, camera, rig);
  // In a time-lapse the whole world races: clouds stream, traffic and crowds rush about.
  const rush = lapseRush();
  // Out at the planet (title or time-lapse) there's no single focus: the whole visible face lives.
  const focus = playing && !cinematic ? ground : null;
  clouds.update(dt * (1 + rush * 30), camera, focus);
  const nearNpc = playing ? npcs.nearest(ground) : null;
  // Walking away ends the conversation.
  if (dialogue.isOpen && !nearNpc) dialogue.close();
  npcs.update(clock.elapsedTime, dt, focus, camera, !dialogue.isOpen);
  world.update(dt);
  space.update(dt, camera);
  const hostile = playing && !rideTo && !isBusy() && lapse === null && daylight.lamps > 0.3 && !agberosSettled(game.state, game.now());
  for (let i = 0, n = 1 + Math.round(rush * 4); i < n; i++) traffic.update(dt, focus, camera, rideTo ? { p: ride.position, f: ride.heading } : null, daylight.lamps, hostile ? player.ground : null);
  updateAgberos(dt, hostile);
  bubbles.update(camera);
  smoke.update(dt * (1 + rush * 2), camera, focus, traffic.exhausts());
  moveMarker.update(dt);
  player.setMarkerVisible(playing && !rideTo && !clinicStay);
  // Out of sight while on a danfo or inside the clinic.
  player.root.visible = !rideTo && !clinicStay;
  player.faceMarker(camera);
  birds.update(dt * (1 + rush * 3));

  // Lights ride with whatever we're looking at: the player in play, the planet's visible face on the title.
  const anchor = focus ?? camera.position.clone().setLength(ground.length());
  const minute = shownMinute();
  daylight.update(minute, anchor, rig.right, rig.forward);
  updateClinic(playing, minute, clock.elapsedTime);
  space.setTones(daylight.rock, daylight.speck, daylight.haze);
  world.lights.update(clock.elapsedTime, daylight.lamps);
  windowNight.value = daylight.lamps;

  document.body.classList.toggle('playing', playing);
  document.body.classList.toggle('talking', dialogue.isOpen);
  document.body.classList.toggle('lapse', lapse !== null);
  // First-time info cards for whatever the player has just run into.
  if (playing && !lapse && !rideTo) {
    tips.trigger('move');
    if (near && PLACE_TIPS[near.id]) tips.trigger(PLACE_TIPS[near.id]!);
    if (nearNpc) tips.trigger('talk');
    if (daylight.lamps > 0.6) tips.trigger('night');
  }
  if (playing) hud.update(near, nearNpc, minute, harassed ? { settle: AGBERO.settle, onSettle: settleAgberos } : null);
  renderer.render(scene, camera);
});
