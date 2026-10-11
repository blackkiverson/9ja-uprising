import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { MINUTES_PER_DAY, type WorldTime } from './clock';
import { CLINIC, DANFO, FOOD, KNOCKOUT, OFFICE_SHIFT, STARTING_MONEY, VEHICLE_HIT } from './data';
import { createPlayer, type PlayerState } from './state';

const at = (day: number, minuteOfDay: number): WorldTime => ({
  day,
  minuteOfDay,
  totalMinutes: day * MINUTES_PER_DAY + minuteOfDay,
});

const ok = (r: ReturnType<typeof applyAction>): PlayerState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe('applyAction', () => {
  it('pays a shift at the office during hours and blocks until it ends', () => {
    const p = { ...createPlayer(), location: 'office' as const };
    const after = ok(applyAction(p, { type: 'work_shift' }, at(5, 8 * 60)));
    expect(after.money).toBe(STARTING_MONEY + OFFICE_SHIFT.pay);
    expect(after.energy).toBe(100 - OFFICE_SHIFT.energyCost);
    const blocked = applyAction(after, { type: 'eat', item: 'gala' }, at(5, 9 * 60));
    expect(blocked.ok).toBe(false);
  });

  it('refuses a shift outside hours', () => {
    const p = { ...createPlayer(), location: 'office' as const };
    expect(applyAction(p, { type: 'work_shift' }, at(5, 14 * 60)).ok).toBe(false);
  });

  it('buys then eats food', () => {
    const p = { ...createPlayer(), location: 'food_stall' as const, energy: 50 };
    const bought = ok(applyAction(p, { type: 'buy_food', item: 'rice_and_stew' }, at(1, 600)));
    expect(bought.money).toBe(STARTING_MONEY - FOOD.rice_and_stew.price);
    const fed = ok(applyAction(bought, { type: 'eat', item: 'rice_and_stew' }, at(1, 601)));
    expect(fed.energy).toBe(50 + FOOD.rice_and_stew.energy);
    expect(fed.inventory.rice_and_stew).toBe(0);
  });

  it('charges danfo fare and moves the player', () => {
    const p = { ...createPlayer(), location: 'bus_stop' as const };
    const after = ok(applyAction(p, { type: 'danfo', to: 'office' }, at(1, 420)));
    expect(after.location).toBe('office');
    expect(after.money).toBe(STARTING_MONEY - DANFO.fare);
  });

  it('sleeps through to morning once a night and counts personal days', () => {
    const p = { ...createPlayer(), energy: 10 };
    const slept = ok(applyAction(p, { type: 'sleep' }, at(3, 22 * 60)));
    expect(slept.personalDay).toBe(2);
    expect(slept.energy).toBe(100);
    expect(slept.timeOffset).toBe(8 * 60 + 30); // 22:00 to 06:30
    // 01:00 is still the same night.
    expect(applyAction(slept, { type: 'sleep' }, at(4, 60)).ok).toBe(false);
    expect(ok(applyAction(slept, { type: 'sleep' }, at(4, 22 * 60))).personalDay).toBe(3);
  });

  it('refuses sleep in the daytime unless exhausted', () => {
    expect(applyAction(createPlayer(), { type: 'sleep' }, at(3, 12 * 60)).ok).toBe(false);
    expect(applyAction({ ...createPlayer(), energy: 20 }, { type: 'sleep' }, at(3, 12 * 60)).ok).toBe(true);
  });

  it('fast-forwards to the end of a shift by moving the personal clock', () => {
    const p = { ...createPlayer(), location: 'office' as const };
    const working = ok(applyAction(p, { type: 'work_shift' }, at(5, 8 * 60)));
    expect(working.busyWith).toBe('work');
    const r = applyAction(working, { type: 'fast_forward' }, at(5, 9 * 60));
    expect(r.ok && r.skipped).toBe(7 * 60);
    const after = ok(r);
    expect(after.timeOffset).toBe(7 * 60);
    expect(after.busyWith).toBe(null);
    // At the new personal time (16:00) the player is free again.
    expect(applyAction(after, { type: 'fast_forward' }, at(5, 16 * 60)).ok).toBe(false);
    expect(applyAction(after, { type: 'eat', item: 'gala' }, at(5, 16 * 60)).ok).toBe(false); // free, just no gala
    expect(applyAction({ ...after, inventory: { gala: 1 } }, { type: 'eat', item: 'gala' }, at(5, 16 * 60)).ok).toBe(true);
  });

  it('does not mutate the previous state', () => {
    const p = { ...createPlayer(), location: 'food_stall' as const };
    applyAction(p, { type: 'buy_food', item: 'gala' }, at(1, 600));
    expect(p.money).toBe(STARTING_MONEY);
    expect(p.inventory).toEqual({});
  });

  it('takes health when hit by a vehicle, more at speed, even while busy', () => {
    const p = { ...createPlayer(), busyUntil: at(1, 700).totalMinutes };
    const fast = ok(applyAction(p, { type: 'hit_by_vehicle', vehicle: 'danfo', speed: 20 }, at(1, 600)));
    expect(fast.health).toBe(100 - VEHICLE_HIT.danfo.damage);
    const slow = ok(applyAction(p, { type: 'hit_by_vehicle', vehicle: 'danfo', speed: VEHICLE_HIT.danfo.topSpeed / 2 }, at(1, 600)));
    expect(slow.health).toBe(100 - VEHICLE_HIT.danfo.damage / 2);
    expect(applyAction(p, { type: 'hit_by_vehicle', vehicle: 'car', speed: 0.5 }, at(1, 600)).ok).toBe(false);
  });

  it('knocks you out at zero health: clinic, patched up, billed', () => {
    const p = { ...createPlayer(), health: 5, location: 'office' as const };
    const r = applyAction(p, { type: 'hit_by_vehicle', vehicle: 'car', speed: 8 }, at(1, 600));
    expect(r.ok && r.knockedOut).toBe(true);
    const after = ok(r);
    expect(after.health).toBe(KNOCKOUT.health);
    expect(after.location).toBe('clinic');
    expect(after.money).toBe(STARTING_MONEY - KNOCKOUT.bill);
    expect(after.busyUntil).toBe(at(1, 600).totalMinutes + KNOCKOUT.minutes);
  });

  it('heals at the clinic for money', () => {
    const p = { ...createPlayer(), location: 'clinic' as const, health: 40 };
    const aid = ok(applyAction(p, { type: 'treat', treatment: 'first_aid' }, at(1, 600)));
    expect(aid.health).toBe(65);
    expect(aid.money).toBe(STARTING_MONEY - CLINIC.first_aid.price);
    // Full treatment charges per point restored and keeps you a while.
    const full = ok(applyAction(aid, { type: 'treat', treatment: 'full' }, at(1, 601)));
    expect(full.health).toBe(100);
    expect(full.money).toBe(aid.money - 35 * CLINIC.full.price);
    expect(full.busyWith).toBe('treatment');
    expect(applyAction({ ...full, busyUntil: 0 }, { type: 'treat', treatment: 'first_aid' }, at(1, 700)).ok).toBe(false);
    expect(applyAction({ ...p, location: 'home' as const }, { type: 'treat', treatment: 'first_aid' }, at(1, 600)).ok).toBe(false);
  });
});
