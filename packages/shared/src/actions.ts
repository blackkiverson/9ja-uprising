import { MINUTES_PER_DAY, formatClock, type WorldTime } from './clock';
import { AGBERO, CLINIC, DANFO, skipPrice, DANFO_ROUTES, FOOD, HIT_MIN_SPEED, KNOCKOUT, MAX_ENERGY, OFFICE_SHIFT, SLEEP, VEHICLE_HIT, type FoodId, type LocationId, type TreatmentId, type VehicleKind } from './data';
import { CLOTHES, type ClothingId, type ClothingSlot } from './clothes';
import { applyChoice, checkChoice, type NpcId } from './dialogue';
import type { PlayerState } from './state';

export type Action =
  | { type: 'enter'; location: LocationId }
  | { type: 'work_shift' }
  | { type: 'buy_food'; item: FoodId }
  | { type: 'eat'; item: FoodId }
  | { type: 'danfo'; to: LocationId }
  | { type: 'sleep' }
  | { type: 'relationship'; npc: string; delta: number }
  | { type: 'dialogue'; npc: NpcId; node: string; choice: number }
  | { type: 'hit_by_vehicle'; vehicle: VehicleKind; speed: number }
  | { type: 'fast_forward' }
  /** The danfo pulled up: the clock catches up to the ride's end, free (only while travelling). */
  | { type: 'arrive' }
  | { type: 'treat'; treatment: TreatmentId }
  | { type: 'settle_agberos' }
  /** At the market: buy an item (you put it straight on). */
  | { type: 'buy_clothes'; item: ClothingId }
  /** At home: change into something you own. Only the hat slot can be left empty (null). */
  | { type: 'wear'; slot: ClothingSlot; item: ClothingId | null }
  /** push: shoved to the ground (health); rob: pockets emptied (money). The caller rolls which. */
  | { type: 'agbero_rough_up'; kind: 'push' | 'rob' };

export type ActionResult =
  | { ok: true; state: PlayerState; message: string; knockedOut?: boolean; skipped?: number }
  | { ok: false; reason: string };

const fail = (reason: string): ActionResult => ({ ok: false, reason });

/**
 * Pure rules function: same input, same output, no rendering or I/O.
 * The client calls it in 0.1; the server will call it to validate actions in multiplayer.
 */
export function applyAction(prev: PlayerState, action: Action, now: WorldTime): ActionResult {
  // Traffic doesn't wait for you to be free.
  if (action.type === 'hit_by_vehicle') return hitByVehicle(prev, action.vehicle, action.speed, now);
  if (action.type === 'fast_forward') return fastForward(prev, now);
  if (action.type === 'arrive') {
    if (prev.busyWith !== 'travel' || prev.busyUntil <= now.totalMinutes) return fail('Not on a ride.');
    const s = JSON.parse(JSON.stringify(prev)) as PlayerState;
    const left = s.busyUntil - now.totalMinutes;
    s.timeOffset += left;
    s.busyWith = null;
    return { ok: true, state: s, message: '', skipped: left };
  }
  if (action.type === 'agbero_rough_up') return roughUp(prev, action.kind, now);
  if (now.totalMinutes < prev.busyUntil) {
    return fail(`Busy for another ${prev.busyUntil - now.totalMinutes} minutes.`);
  }
  // JSON clone: state is plain data, and this works in any runtime (browser or server).
  const s = JSON.parse(JSON.stringify(prev)) as PlayerState;

  switch (action.type) {
    case 'enter':
      s.location = action.location;
      return { ok: true, state: s, message: '' };

    case 'work_shift': {
      if (s.location !== 'office') return fail('You need to be at the office.');
      if (now.minuteOfDay < OFFICE_SHIFT.startsFrom || now.minuteOfDay > OFFICE_SHIFT.latestStart) {
        return fail('Oga says shifts start between 07:00 and 10:00.');
      }
      if (s.energy < OFFICE_SHIFT.energyCost) return fail('Too tired to work. Eat or sleep first.');
      s.energy -= OFFICE_SHIFT.energyCost;
      s.busyUntil = now.totalMinutes + OFFICE_SHIFT.durationMinutes;
      s.busyWith = 'work';
      // A salary advance from Oga Bayo comes out of the next shift.
      const advance = s.flags.oga_advance === true ? 5000 : 0;
      s.flags.oga_advance = false;
      s.money += OFFICE_SHIFT.pay - advance;
      const repaid = advance ? ` (₦${advance.toLocaleString()} advance repaid)` : '';
      return { ok: true, state: s, message: `Shift started. ₦${(OFFICE_SHIFT.pay - advance).toLocaleString()} comes in as you work${repaid}.` };
    }

    case 'buy_food': {
      if (s.location !== 'food_stall') return fail('You need to be at the food stall.');
      const food = FOOD[action.item];
      if (s.money < food.price) return fail(`Not enough money for ${food.name}.`);
      s.money -= food.price;
      s.inventory[action.item] = (s.inventory[action.item] ?? 0) + 1;
      return { ok: true, state: s, message: `Bought ${food.name}.` };
    }

    case 'buy_clothes': {
      if (s.location !== 'market') return fail('Clothes are sold at the market.');
      const c = CLOTHES[action.item];
      if (!c) return fail('The trader no get that one.');
      if (s.wardrobe.includes(action.item)) return fail('You already own that.');
      if (s.money < c.price) return fail(`${c.name} costs ₦${c.price.toLocaleString()}. You no get am.`);
      s.money -= c.price;
      s.wardrobe.push(action.item);
      s.outfit[c.slot] = action.item;
      return { ok: true, state: s, message: `Bought ${c.name}. Fresh!` };
    }

    case 'wear': {
      if (s.location !== 'home') return fail('Change at home.');
      if (action.item === null) {
        if (action.slot !== 'hat') return fail('You cannot go out without that.');
        s.outfit.hat = null;
        return { ok: true, state: s, message: '' };
      }
      const c = CLOTHES[action.item];
      if (!c || c.slot !== action.slot) return fail('That does not go there.');
      if (!s.wardrobe.includes(action.item)) return fail('You do not own that.');
      s.outfit[c.slot] = action.item;
      return { ok: true, state: s, message: '' };
    }

    case 'eat': {
      const have = s.inventory[action.item] ?? 0;
      if (have < 1) return fail('You have none of that.');
      const food = FOOD[action.item];
      s.inventory[action.item] = have - 1;
      s.energy = Math.min(MAX_ENERGY, s.energy + food.energy);
      return { ok: true, state: s, message: `Ate ${food.name}. +${food.energy} energy` };
    }

    case 'danfo': {
      if (!DANFO.boardAt.includes(s.location)) return fail('Danfos leave from the bus stop or the market park.');
      const route = DANFO_ROUTES[action.to];
      if (!route) return fail('No danfo goes there.');
      if (action.to === s.location) return fail('You are already here.');
      if (s.money < route.fare) return fail('Not enough for the fare.');
      if (s.energy < DANFO.energyCost) return fail('Too tired to travel.');
      s.money -= route.fare;
      s.energy -= DANFO.energyCost;
      s.location = action.to;
      s.busyUntil = now.totalMinutes + route.minutes;
      s.busyWith = 'travel';
      return { ok: true, state: s, message: `Danfo to ${route.name.toLowerCase()}. -₦${route.fare}` };
    }

    case 'sleep': {
      if (s.location !== 'home') return fail('You can only sleep at home.');
      // Going to bed at 02:00 still counts as the night before.
      const night = Math.floor((now.totalMinutes - SLEEP.until) / MINUTES_PER_DAY);
      if (s.lastSleptWorldDay === night) return fail('You have already slept tonight.');
      const evening = now.minuteOfDay >= SLEEP.from || now.minuteOfDay < SLEEP.until;
      if (!evening && s.energy >= SLEEP.tiredBelow) return fail(`Too early to sleep. Come back after ${formatClock(SLEEP.from)}.`);
      // Sleep through to the next morning: the personal clock jumps ahead.
      const wake = now.minuteOfDay < SLEEP.wakeAt ? SLEEP.wakeAt - now.minuteOfDay : MINUTES_PER_DAY - now.minuteOfDay + SLEEP.wakeAt;
      s.timeOffset += wake;
      s.energy = MAX_ENERGY;
      s.personalDay += 1;
      s.lastSleptWorldDay = night;
      return { ok: true, state: s, message: `Day ${s.personalDay}. You wake up rested.`, skipped: wake };
    }

    case 'dialogue': {
      const check = checkChoice(s, action.npc, action.node, action.choice, now);
      if (!check.ok) return fail(check.reason || 'You cannot say that.');
      return { ok: true, state: s, message: applyChoice(s, action.npc, action.node, action.choice, now) };
    }

    case 'treat': {
      if (s.location !== 'clinic') return fail('You need to be at the clinic.');
      if (s.health >= 100) return fail('Nurse says you are fine. Go home.');
      const t = CLINIC[action.treatment];
      const heal = Math.min(t.heal, 100 - s.health);
      const price = action.treatment === 'full' ? heal * t.price : t.price;
      if (s.money < price) return fail(`Not enough money for ${t.name.toLowerCase()} (₦${price.toLocaleString()}).`);
      s.money -= price;
      s.health += heal;
      if (t.minutes) {
        s.busyUntil = now.totalMinutes + t.minutes;
        s.busyWith = 'treatment';
      }
      return { ok: true, state: s, message: `${t.name}. +${heal} health, -₦${price.toLocaleString()}` };
    }

    case 'settle_agberos': {
      if (agberosSettled(s, now)) return fail('You don already settle them tonight.');
      if (s.money < AGBERO.settle) return fail('You no get the money. Run!');
      s.money -= AGBERO.settle;
      s.flags.agbero_settled = nightOf(now);
      return { ok: true, state: s, message: `Settled the agberos. -₦${AGBERO.settle}` };
    }

    case 'relationship': {
      const current = s.relationships[action.npc] ?? 0;
      s.relationships[action.npc] = Math.max(-100, Math.min(100, current + action.delta));
      return { ok: true, state: s, message: '' };
    }
  }
}

/** Damage scales with impact speed (capped at the type's top speed); zero health is a knockout. */
function hitByVehicle(prev: PlayerState, vehicle: VehicleKind, speed: number, now: WorldTime): ActionResult {
  const hit = VEHICLE_HIT[vehicle];
  if (!hit || !(speed >= HIT_MIN_SPEED)) return fail('Too slow to hurt.');
  const s = JSON.parse(JSON.stringify(prev)) as PlayerState;
  const damage = Math.max(1, Math.round(hit.damage * Math.min(1, speed / hit.topSpeed)));
  s.health = Math.max(0, s.health - damage);
  if (s.health > 0) return { ok: true, state: s, message: `${hit.name} no dey stop! -${damage} health` };

  return knockOut(s, now, `Knocked down by a ${hit.name.toLowerCase()}.`);
}

/** Zero health: wake at the clinic, patched up, with a bill. Mutates and returns s. */
function knockOut(s: PlayerState, now: WorldTime, cause: string): ActionResult {
  const bill = Math.min(s.money, KNOCKOUT.bill);
  s.health = KNOCKOUT.health;
  s.money -= bill;
  s.location = 'clinic';
  s.busyUntil = now.totalMinutes + KNOCKOUT.minutes;
  s.busyWith = 'recovering';
  return { ok: true, state: s, message: `${cause} You wake up at the clinic. -₦${bill.toLocaleString()}`, knockedOut: true };
}

/** Nights run from 05:00 to 05:00, so a payment at 02:00 covers the night it was made in. */
const nightOf = (now: WorldTime) => Math.floor((now.totalMinutes - 5 * 60) / MINUTES_PER_DAY);

/** True if the player has paid the agberos off tonight. */
export function agberosSettled(s: PlayerState, now: WorldTime): boolean {
  return s.flags.agbero_settled === nightOf(now);
}

/**
 * Agberos rough you up: either a shove to the ground (health) or a robbery (money, up to a cap).
 * With empty pockets a robbery turns into a shove.
 */
function roughUp(prev: PlayerState, kind: 'push' | 'rob', now: WorldTime): ActionResult {
  if (agberosSettled(prev, now)) return fail('They know you. Waka pass.');
  const s = JSON.parse(JSON.stringify(prev)) as PlayerState;
  if (kind === 'rob' && s.money > 0) {
    const taken = Math.min(s.money, AGBERO.snatch);
    s.money -= taken;
    return { ok: true, state: s, message: `Agberos robbed you. -₦${taken.toLocaleString()}` };
  }
  s.health = Math.max(0, s.health - AGBERO.damage);
  if (s.health === 0) return knockOut(s, now, 'The agberos beat you mercilessly.');
  return { ok: true, state: s, message: `Agberos pushed you down. -${AGBERO.damage} health` };
}

/** Skip whatever you're busy with, for a price: the personal clock jumps to when it ends. */
function fastForward(prev: PlayerState, now: WorldTime): ActionResult {
  const left = prev.busyUntil - now.totalMinutes;
  if (left <= 0) return fail('Nothing to skip.');
  const price = skipPrice(left);
  if (prev.money < price) return fail(`Skipping costs ₦${price.toLocaleString()}. You no get am.`);
  const s = JSON.parse(JSON.stringify(prev)) as PlayerState;
  s.money -= price;
  s.timeOffset += left;
  const done = { work: 'Shift over.', travel: 'You have arrived.', recovering: 'Back on your feet.', treatment: 'Discharged.' }[s.busyWith ?? 'work'];
  s.busyWith = null;
  return { ok: true, state: s, message: `${done} -₦${price.toLocaleString()}`, skipped: left };
}
