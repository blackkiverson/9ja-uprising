import type { WorldTime } from './clock';
import { DANFO, FOOD, HIT_MIN_SPEED, KNOCKOUT, MAX_ENERGY, OFFICE_SHIFT, VEHICLE_HIT, type FoodId, type LocationId, type VehicleKind } from './data';
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
  | { type: 'hit_by_vehicle'; vehicle: VehicleKind; speed: number };

export type ActionResult =
  | { ok: true; state: PlayerState; message: string; knockedOut?: boolean }
  | { ok: false; reason: string };

const fail = (reason: string): ActionResult => ({ ok: false, reason });

/**
 * Pure rules function: same input, same output, no rendering or I/O.
 * The client calls it in 0.1; the server will call it to validate actions in multiplayer.
 */
export function applyAction(prev: PlayerState, action: Action, now: WorldTime): ActionResult {
  // Traffic doesn't wait for you to be free.
  if (action.type === 'hit_by_vehicle') return hitByVehicle(prev, action.vehicle, action.speed, now);
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
      // A salary advance from Oga Bayo comes out of the next shift.
      const advance = s.flags.oga_advance === true ? 5000 : 0;
      s.flags.oga_advance = false;
      s.money += OFFICE_SHIFT.pay - advance;
      const repaid = advance ? ` (₦${advance.toLocaleString()} advance repaid)` : '';
      return { ok: true, state: s, message: `Shift done. +₦${(OFFICE_SHIFT.pay - advance).toLocaleString()}${repaid}` };
    }

    case 'buy_food': {
      if (s.location !== 'food_stall') return fail('You need to be at the food stall.');
      const food = FOOD[action.item];
      if (s.money < food.price) return fail(`Not enough money for ${food.name}.`);
      s.money -= food.price;
      s.inventory[action.item] = (s.inventory[action.item] ?? 0) + 1;
      return { ok: true, state: s, message: `Bought ${food.name}.` };
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
      if (s.location !== 'bus_stop') return fail('Danfos leave from the bus stop.');
      if (s.money < DANFO.fare) return fail('Not enough for the fare.');
      if (s.energy < DANFO.energyCost) return fail('Too tired to travel.');
      s.money -= DANFO.fare;
      s.energy -= DANFO.energyCost;
      s.location = action.to;
      s.busyUntil = now.totalMinutes + DANFO.durationMinutes;
      return { ok: true, state: s, message: `Danfo to ${action.to.replace('_', ' ')}. -₦${DANFO.fare}` };
    }

    case 'sleep': {
      if (s.location !== 'home') return fail('You can only sleep at home.');
      if (s.lastSleptWorldDay === now.day) return fail('You have already slept today.');
      s.energy = MAX_ENERGY;
      s.personalDay += 1;
      s.lastSleptWorldDay = now.day;
      return { ok: true, state: s, message: `Day ${s.personalDay}. You wake up rested.` };
    }

    case 'dialogue': {
      const check = checkChoice(s, action.npc, action.node, action.choice, now);
      if (!check.ok) return fail(check.reason || 'You cannot say that.');
      return { ok: true, state: s, message: applyChoice(s, action.npc, action.node, action.choice, now) };
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

  const bill = Math.min(s.money, KNOCKOUT.bill);
  s.health = KNOCKOUT.health;
  s.money -= bill;
  s.location = 'home';
  s.busyUntil = now.totalMinutes + KNOCKOUT.minutes;
  return { ok: true, state: s, message: `Knocked down by a ${hit.name.toLowerCase()}. You wake up at home. -₦${bill.toLocaleString()}`, knockedOut: true };
}
