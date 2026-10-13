import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { MINUTES_PER_DAY, timeAt, type WorldTime } from './clock';
import { PARCEL, PARCEL_DROPS, newErrand } from './errands';
import { createPlayer, type PlayerState } from './state';

const noon: WorldTime = timeAt(2 * MINUTES_PER_DAY + 720);
const ok = (r: ReturnType<typeof applyAction>): PlayerState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
const atStop = (): PlayerState => ({ ...createPlayer(), location: 'bus_stop' });

describe('parcel runs', () => {
  it('hands out a parcel at the bus stop only, for energy', () => {
    expect(applyAction(createPlayer(), { type: 'take_parcel' }, noon).ok).toBe(false);
    const p = ok(applyAction(atStop(), { type: 'take_parcel' }, noon));
    expect(p.errand).not.toBeNull();
    expect(p.energy).toBe(100 - PARCEL.energyCost);
    expect(PARCEL_DROPS[p.errand!.to]).toBeDefined();
    expect(p.errand!.who).toBeLessThan(PARCEL.crowd);
    // One at a time.
    expect(applyAction(p, { type: 'take_parcel' }, noon).ok).toBe(false);
  });

  it('pays the right person in full on time, half when late, nothing for the wrong one', () => {
    const p = ok(applyAction(atStop(), { type: 'take_parcel' }, noon));
    const e = p.errand!;
    expect(applyAction(p, { type: 'deliver_parcel', who: (e.who + 1) % PARCEL.crowd }, noon).ok).toBe(false);
    const done = ok(applyAction(p, { type: 'deliver_parcel', who: e.who }, noon));
    expect(done.money).toBe(p.money + e.pay);
    expect(done.respect).toBe(1);
    expect(done.errand).toBeNull();
    const late = ok(applyAction(p, { type: 'deliver_parcel', who: e.who }, timeAt(e.due + 1)));
    expect(late.money).toBe(p.money + Math.round(e.pay * PARCEL.latePay));
    expect(late.respect).toBe(0);
  });

  it('runs out of parcels for the day', () => {
    let p = atStop();
    for (let i = 0; i < PARCEL.perDay; i++) {
      p = ok(applyAction(p, { type: 'take_parcel' }, noon));
      p = ok(applyAction(p, { type: 'return_parcel' }, noon));
    }
    expect(applyAction(p, { type: 'take_parcel' }, noon).ok).toBe(false);
    expect(ok(applyAction(p, { type: 'take_parcel' }, timeAt(noon.totalMinutes + MINUTES_PER_DAY))).errand).not.toBeNull();
  });

  it('is the same errand from the same seed', () => {
    expect(newErrand(42, 100)).toEqual(newErrand(42, 100));
  });
});
