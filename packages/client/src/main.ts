import '@fontsource/bungee';
import * as THREE from 'three';
import { AGBERO, AGBERO_LINES, CLINIC, DANFO_ROUTES, KNOCKOUT, OFFICE_SHIFT, PARCEL_LINES, STARTER_OUTFIT, agberosSettled, formatClock, isClothingId, type WornOutfit } from '@9ja/shared';
import { Bubbles } from './bubbles';
import { Tips, type TipId } from './tips';
import { Game } from './game';
import { Music } from './audio/music';
import { Dialogue } from './dialogue';
import { Hud } from './hud';
import { Keyboard } from './input';
import { CameraRig, Intro, LapseCam, createCamera, fadeOccluders } from './scene/camera';
import { Birds } from './scene/birds';
import { Pigeons } from './scene/pigeons';
import { Clouds } from './scene/clouds';
import { Daylight, skyChange } from './scene/daylight';
import { DanfoRide } from './scene/ride';
import { windowNight } from './scene/nightlights';
import { Npcs } from './scene/npcs';
import { ParcelCrowd } from './scene/parcels';
import { Smoke } from './scene/smoke';
import { Space } from './scene/space';
import { Rng } from './scene/rng';
import { PlayerAvatar } from './scene/player';
import { outfitOf, sameOutfit } from './scene/character';
import { Closet } from './closet';
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
const parcels = new ParcelCrowd(scene, (id) => placeById(id).door, world.collisions, world.heightAt);
let dialogue: Dialogue;
const hud = new Hud(
  game,
  (to) => boardDanfo(to),
  (npc) => dialogue.open(npc),
  (minutes) => startLapse(minutes),
  (mode) => closet.open(mode),
);
dialogue = new Dialogue(game, (text) => hud.toast(text));
const closet = new Closet(game, (text) => hud.toast(text));
game.onDaily((reward) => hud.dailyDone(reward));
// E talks to whoever is closest (or asks about the parcel).
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || dialogue.isOpen || intro.active) return;
  const asking = parcelStep();
  if (asking) return asking.onClick();
  const npc = npcs.nearest(player.ground);
  if (npc) dialogue.open(npc);
});

// --- Parcel runs: at the drop-off, ask round until someone says it's theirs, then hand it over. ---
/** The next step with whoever at the drop-off is in reach, if anyone. */
function parcelStep(): { label: string; onClick: () => void } | null {
  const e = game.state.errand;
  const i = e && !isBusy() ? parcels.nearest(player.ground) : null;
  if (!e || i === null) return null;
  // Worked out again on the click: the button can outlive the person it was made for.
  return { label: i === e.who && parcels.asked(i) ? `📦 Give ${e.name} the parcel` : '🗣️ Ask about the parcel', onClick: takeParcelStep };
}
function takeParcelStep(): void {
  const e = game.state.errand;
  const i = e && !isBusy() ? parcels.nearest(player.ground) : null;
  if (!e || i === null) return;
  if (i === e.who && parcels.asked(i)) return giveParcel(i);
  parcels.markAsked(i);
  bubbles.say(parcels.at(i), i === e.who ? PARCEL_LINES.right : pick(PARCEL_LINES.wrong), 3, 'calm');
}
function giveParcel(i: number): void {
  const e = game.state.errand;
  const late = !!e && game.now().totalMinutes > e.due;
  const r = game.dispatch({ type: 'deliver_parcel', who: i });
  hud.toast(r.ok ? r.message : r.reason);
  if (r.ok) bubbles.say(parcels.at(i), pick(late ? PARCEL_LINES.late : PARCEL_LINES.thanks), 3.2, 'calm');
}
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
  if (hit && !isBusy() && !intro.active && !dialogue.isOpen && !closet.isOpen && touches.size === 0) {
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
const pigeons = new Pigeons(scene, new Rng(57), world.occluders, [world.interiors.office.mesh, world.interiors.clinic.mesh]);
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
// What the player has on: their saved outfit, or what they're trying on at the stall.
let shownOutfit: WornOutfit | null = null;
function syncOutfit(): void {
  const saved = game.state.outfit;
  // A save from a future (or broken) build might name clothes this one doesn't know.
  const worn = closet.preview ?? (validOutfit(saved) ? saved : STARTER_OUTFIT);
  if (shownOutfit && sameOutfit(worn, shownOutfit)) return;
  player.setOutfit(outfitOf(worn));
  shownOutfit = { ...worn };
}
const validOutfit = (o: WornOutfit | undefined): o is WornOutfit =>
  !!o && isClothingId(o.top) && isClothingId(o.bottom) && isClothingId(o.shoes) && (o.hat === null || isClothingId(o.hat));
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
if (import.meta.env.DEV) Object.assign(window, { __9ja: { game, player, places, scene, renderer, camera, world, rig, THREE, teleportTo, intro, npcs, dialogue, traffic, findPath, music, smoke, pigeons, parcels } });

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
let lapse: { from: number; to: number; t: number; dur: number; start: number; table: number[] } | null = null;
const lapseCam = new LapseCam();
function startLapse(minutes: number): void {
  const to = game.exactNow();
  // Long enough to pull out, spin the planet and dive back in.
  const from = to - minutes;
  // table[i]: share of the lapse used up by minute from + i, weighted by how much the sky changes.
  const table = [0];
  for (let i = 0; i < Math.ceil(minutes); i++) table.push(table[i]! + skyChange(from + i + 0.5));
  const total = table.at(-1) || 1;
  for (let i = 0; i < table.length; i++) table[i]! /= total;
  lapse = { from, to, t: 0, dur: THREE.MathUtils.clamp(3.6 + minutes / 160, 4.5, 7.5), start: performance.now(), table };
  player.followPath([]);
  lapseCam.start(camera, rig);
}
/** 0 to 1 and back over the lapse: how hard the world is racing right now. */
const lapseRush = () => (lapse ? Math.sin(Math.PI * Math.min(1, lapse.t / lapse.dur)) : 0);
const shownMinute = () => {
  if (!lapse) return game.exactNow();
  const t = Math.min(1, lapse.t / lapse.dur);
  const s = t * t * (3 - 2 * t);
  // Invert the table: which minute has that share of the sky's change behind it.
  const { table } = lapse;
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const f = (s - table[lo]!) / (table[hi]! - table[lo]! || 1);
  return Math.min(lapse.to, lapse.from + lo + f);
};

// --- Inside a building (a shift at the office, recovering at the clinic): you're hidden, the
// building glows in and out, and a pie over it fills until you come out. ---
type StayKind = 'office' | 'clinic';
const pieEl = document.getElementById('stay-pie')!;
const pieFill = pieEl.querySelector('.pie') as HTMLElement;
const pieLabel = pieEl.querySelector('span')!;
let stay: { kind: StayKind; from: number; until: number; pay: number } | null = null;
/** The rules pay a shift up front; the HUD holds back what isn't earned yet so it counts up. */
let unpaid = 0;
let lastMoney: number | null = null;
function stayingAt(): { kind: StayKind; minutes: number } | null {
  if (!isBusy()) return null;
  const { busyWith, location } = game.state;
  if (busyWith === 'work' && location === 'office') return { kind: 'office', minutes: OFFICE_SHIFT.durationMinutes };
  if (busyWith === 'recovering' && location === 'clinic') return { kind: 'clinic', minutes: KNOCKOUT.minutes };
  if (busyWith === 'treatment' && location === 'clinic') return { kind: 'clinic', minutes: CLINIC.full.minutes };
  return null;
}
function updateStay(playing: boolean, minute: number, t: number): void {
  const now = playing ? stayingAt() : null;
  if (now) {
    // The shift's pay landed with the click; on a reload mid-shift, assume the full wage.
    const pay = now.kind === 'office' ? (lastMoney === null ? OFFICE_SHIFT.pay : Math.max(0, game.state.money - lastMoney)) : 0;
    stay ??= { kind: now.kind, from: game.state.busyUntil - now.minutes, until: game.state.busyUntil, pay };
  } else if (stay && !lapse) {
    // Hold through a skip's time-lapse, then out of the door.
    if (stay.kind === 'office') teleportTo(placeById('office').door);
    stay = null;
  }
  if (playing) lastMoney = game.state.money;
  const k = 0.5 + 0.5 * Math.sin(t * 3);
  for (const kind of ['office', 'clinic'] as const) {
    const g = stay?.kind === kind ? k : 0;
    (world.interiors[kind].mesh.material as THREE.MeshToonMaterial).emissive.setRGB(0.5 * g, 0.42 * g, 0.36 * g);
  }
  const p = stay ? THREE.MathUtils.clamp((minute - stay.from) / (stay.until - stay.from), 0, 1) : 1;
  unpaid = stay ? stay.pay * (1 - p) : 0;
  if (!stay || !playing) {
    pieEl.hidden = true;
    return;
  }
  pieFill.style.setProperty('--p', p.toFixed(3));
  const at = formatClock(((stay.until % 1440) + 1440) % 1440);
  pieLabel.textContent = stay.kind === 'office' ? (p >= 1 ? 'Shift done!' : `Shift ends ${at}`) : p >= 1 ? 'Ready!' : `Ready at ${at}`;
  if (tour.subject) {
    // Touring: keep the pie in view, top centre.
    pieEl.hidden = false;
    pieEl.style.transform = `translate(-50%, 0) translate(${innerWidth / 2}px, 70px)`;
    return;
  }
  const { frame, mesh } = world.interiors[stay.kind];
  const top = frame.toWorld(0, (mesh.userData.bounds as THREE.Box3).max.y + 1, 0); // just above the roof
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
// --- Waiting inside: left alone, the camera wanders off to watch the town (people, pigeons,
// traffic, agberos after dark); any tap or key snaps it back to the building. ---
const TOUR_AFTER = 4;
const TOUR_HOLD = 9;
/** Seconds to glide from one thing to the next: an unhurried, eased pan. */
const TOUR_GLIDE = 4;
const _tourAt = new THREE.Vector3();
const tour = { idle: 0, hold: 0, subject: null as THREE.Vector3 | null, back: false, from: new THREE.Vector3(), t: 0 };
const wake = () => {
  tour.idle = 0;
  if (tour.subject) tour.back = true;
  tour.subject = null;
};
window.addEventListener('pointerdown', wake, true);
window.addEventListener('keydown', wake, true);
if (import.meta.env.DEV) Object.assign((window as unknown as { __9ja: object }).__9ja, { tour });
const pickOne = <T,>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];
/** What the camera should watch instead of the building, if anything. */
function updateTour(dt: number): THREE.Vector3 | null {
  if (!stay || lapse) {
    tour.idle = 0;
    tour.subject = null;
    return null;
  }
  tour.idle += dt;
  if (tour.idle < TOUR_AFTER) return null;
  tour.hold -= dt;
  if (!tour.subject || tour.hold <= 0) {
    const at = world.interiors[stay.kind].frame.c;
    // Somewhere else: not the building you're in (or its own pigeons).
    const away = (l: THREE.Vector3[]) => l.filter((p) => p.distanceTo(at) > 10);
    const kinds = [npcs.subjects(at, 45), pigeons.subjects(at, 45), traffic.subjects(at, 45, daylight.lamps)].map(away).filter((l) => l.length);
    const list = pickOne(kinds);
    if (list) tour.subject = pickOne(list.filter((p) => p !== tour.subject)) ?? list[0]!;
    tour.hold = TOUR_HOLD;
    tour.from.copy(rig.focus);
    tour.t = 0;
  }
  if (!tour.subject) return null;
  // Ease out from where the camera is to the subject (which may be moving), then ride along.
  tour.t += dt;
  const k = Math.min(1, tour.t / TOUR_GLIDE);
  const e = k * k * k * (k * (k * 6 - 15) + 10);
  return _tourAt.lerpVectors(tour.from, tour.subject, e).setLength(tour.subject.length());
}

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
  const busy = isBusy() || !playing || dialogue.isOpen || closet.isOpen || lapse !== null;
  if (keyboard.consumeJump() && !busy) player.jump();

  // WASD is relative to the screen: W walks "up" the screen along the planet.
  const input = busy ? new THREE.Vector2() : keyboard.direction();
  walk.set(0, 0, 0).addScaledVector(rig.right, input.x).addScaledVector(rig.forward, -input.y);
  player.update(dt, walk, world.collisions, world.heightAt);
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
  const struck = rideTo || stay ? null : player.push((p) => {
    const hit = traffic.pushOut(p);
    // Thrown clear, but never into a wall.
    if (hit) world.collisions.resolve(p);
    return hit;
  });
  if (struck && playing && hitCooldown === 0) onStruck(struck.vehicle, struck.speed);

  const near = playing ? nearestPlace() : null;
  if (near && near.id !== game.state.location) game.dispatch({ type: 'enter', location: near.id });
  // Knocked away from the stall or the house (a car, an agbero): the panel goes.
  if (closet.isOpen && near?.id !== (closet.openMode === 'shop' ? 'market' : 'home')) closet.close();
  syncOutfit();

  const ground = player.ground;
  if (playing && cinematic && lapse) lapseCam.update(lapse.t, lapse.dur, camera, rig, ground);
  else if (playing) {
    // Inside a building the camera watches the building (or wanders, if left alone), and nothing
    // fades: it's what you look at.
    const watching = updateTour(dt);
    // Trying on clothes: close in, low, and keep the player clear of the panel (beside it on wide
    // screens, above it on phones). They turn to face you.
    rig.closeUp += ((closet.isOpen ? 1 : 0) - rig.closeUp) * (1 - Math.exp(-4 * dt));
    if (rig.closeUp < 0.001) rig.closeUp = 0;
    let home = stay ? world.interiors[stay.kind].frame.c : ground;
    if (rig.closeUp > 0) {
      const wide = camera.aspect > 1;
      home = ground.clone().addScaledVector(wide ? rig.right : rig.forward, (wide ? 1.3 : -2.6) * rig.closeUp);
      if (closet.isOpen) player.turnTowards(camera.position.clone().sub(ground).normalize(), dt);
    }
    // The tour steers the camera itself (smooth glides); a tap snaps it home.
    rig.update(watching ?? home, dt, tour.back || watching !== null);
    tour.back = false;
    fadeOccluders(camera, stay ? null : ground, world.occluders, dt);
  } else intro.update(dt, camera, rig);
  // In a time-lapse the whole world races: clouds stream, traffic and crowds rush about.
  const rush = lapseRush();
  // Out at the planet (title or time-lapse) there's no single focus: the whole visible face lives.
  // While the camera tours, the town comes alive where it's looking, not round the hidden player.
  const focus = playing && !cinematic ? (tour.subject ? rig.focus : ground) : null;
  clouds.update(dt * (1 + rush * 30), camera, focus);
  const nearNpc = playing ? npcs.nearest(ground) : null;
  // Walking away ends the conversation.
  if (dialogue.isOpen && !nearNpc) dialogue.close();
  npcs.update(clock.elapsedTime, dt, focus, camera, !dialogue.isOpen);
  parcels.sync(game.state.errand, dt);
  parcels.update(dt, focus);
  world.update(dt);
  space.update(dt, camera);
  const hostile = playing && !rideTo && !isBusy() && lapse === null && daylight.lamps > 0.3 && !agberosSettled(game.state, game.now());
  for (let i = 0, n = 1 + Math.round(rush * 4); i < n; i++) traffic.update(dt, focus, camera, rideTo ? { p: ride.position, f: ride.heading } : null, daylight.lamps, hostile ? player.ground : null);
  updateAgberos(dt, hostile);
  bubbles.update(camera);
  smoke.update(dt * (1 + rush * 2), camera, focus, traffic.exhausts());
  moveMarker.update(dt);
  player.setMarkerVisible(playing && !rideTo && !stay && !closet.isOpen);
  // Out of sight while on a danfo or inside a building.
  player.root.visible = !rideTo && !stay;
  player.faceMarker(camera);
  birds.update(dt * (1 + rush * 3));
  pigeons.update(dt * (1 + rush * 3), playing && !cinematic && !stay ? ground : null, daylight.lamps);

  // Lights ride with whatever we're looking at: the player in play, the planet's visible face on the title.
  const anchor = focus ?? camera.position.clone().setLength(ground.length());
  const minute = shownMinute();
  daylight.update(minute, anchor, rig.right, rig.forward);
  updateStay(playing, minute, clock.elapsedTime);
  space.setTones(daylight.rock, daylight.speck, daylight.haze);
  world.lights.update(clock.elapsedTime, daylight.lamps);
  windowNight.value = daylight.lamps;

  document.body.classList.toggle('playing', playing);
  document.body.classList.toggle('talking', dialogue.isOpen);
  document.body.classList.toggle('closet', closet.isOpen);
  document.body.classList.toggle('lapse', lapse !== null);
  // First-time info cards for whatever the player has just run into.
  if (playing && !lapse && !rideTo) {
    tips.trigger('move');
    if (near && PLACE_TIPS[near.id]) tips.trigger(PLACE_TIPS[near.id]!);
    if (nearNpc) tips.trigger('talk');
    if (game.state.errand) tips.trigger('parcel');
    if (daylight.lamps > 0.6) tips.trigger('night');
  }
  if (playing) hud.update(near, nearNpc, minute, harassed ? { settle: AGBERO.settle, onSettle: settleAgberos } : null, unpaid, parcelStep());
  renderer.render(scene, camera);
});
