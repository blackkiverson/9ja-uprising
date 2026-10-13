import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { MINUTES_PER_DAY, timeAt } from './clock';
import { DAILY_TASKS, dailyProgress, dailyTask } from './daily';
import { createPlayer, type PlayerState } from './state';

/** First world day whose task is this one. */
const dayOf = (id: string) => {
  for (let d = 0; d < 500; d++) if (dailyTask(d).id === id) return d;
  throw new Error(`no day for ${id}`);
};
const ok = (r: ReturnType<typeof applyAction>): PlayerState & { _daily?: string } => {
  if (!r.ok) throw new Error(r.reason);
  return Object.assign(r.state, { _daily: r.daily });
};

describe('daily task', () => {
  it('is the same for a given day, every task comes up, and never twice running', () => {
    expect(dailyTask(12)).toBe(dailyTask(12));
    const seen = new Set<string>();
    for (let d = 1; d < 400; d++) {
      seen.add(dailyTask(d).id);
      expect(dailyTask(d).id).not.toBe(dailyTask(d - 1).id);
    }
    expect(seen.size).toBe(DAILY_TASKS.length);
  });

  it('counts progress, pays once on completion, and resets the next day', () => {
    const day = dayOf('water');
    const now = timeAt(day * MINUTES_PER_DAY + 720);
    let p: PlayerState = { ...createPlayer(), location: 'food_stall' };
    const money = p.money;
    p = ok(applyAction(p, { type: 'buy_food', item: 'pure_water' }, now));
    p = ok(applyAction(p, { type: 'buy_food', item: 'puff_puff' }, now));
    expect(dailyProgress(p, now).progress).toBe(1);
    p = ok(applyAction(p, { type: 'buy_food', item: 'pure_water' }, now));
    const done = ok(applyAction(p, { type: 'buy_food', item: 'pure_water' }, now));
    expect(done._daily).toBeDefined();
    expect(dailyProgress(done, now).done).toBe(true);
    expect(done.money).toBe(money - 3 * 50 - 200 + 300);
    // Done for today: no second payout.
    expect(ok(applyAction(done, { type: 'buy_food', item: 'pure_water' }, now))._daily).toBeUndefined();
    // Tomorrow starts afresh.
    expect(dailyProgress(done, timeAt(now.totalMinutes + MINUTES_PER_DAY))).toMatchObject({ progress: 0, done: false });
  });

  it('only counts on-time parcels', () => {
    const day = dayOf('parcels');
    const now = timeAt(day * MINUTES_PER_DAY + 600);
    let p = ok(applyAction({ ...createPlayer(), location: 'bus_stop' }, { type: 'take_parcel' }, now));
    p = ok(applyAction(p, { type: 'deliver_parcel', who: p.errand!.who }, timeAt(p.errand!.due + 5)));
    expect(dailyProgress(p, now).progress).toBe(0);
  });
});
