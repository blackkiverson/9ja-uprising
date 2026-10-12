import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { MINUTES_PER_DAY, type WorldTime } from './clock';
import { CLOTHES, STARTER_OUTFIT } from './clothes';
import { STARTING_MONEY } from './data';
import { createPlayer, type PlayerState } from './state';

const noon: WorldTime = { day: 2, minuteOfDay: 720, totalMinutes: 2 * MINUTES_PER_DAY + 720 };
const ok = (r: ReturnType<typeof applyAction>): PlayerState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe('clothes', () => {
  it('starts dressed in the starter outfit, which is owned', () => {
    const p = createPlayer();
    expect(p.outfit).toEqual(STARTER_OUTFIT);
    for (const id of [p.outfit.top, p.outfit.bottom, p.outfit.shoes]) expect(p.wardrobe).toContain(id);
  });

  it('sells at the market only, charges, and puts the item on', () => {
    const home = createPlayer();
    expect(applyAction(home, { type: 'buy_clothes', item: 'cap_red' }, noon).ok).toBe(false);
    const after = ok(applyAction({ ...home, location: 'market' }, { type: 'buy_clothes', item: 'cap_red' }, noon));
    expect(after.money).toBe(STARTING_MONEY - CLOTHES.cap_red.price);
    expect(after.wardrobe).toContain('cap_red');
    expect(after.outfit.hat).toBe('cap_red');
    // Not twice.
    expect(applyAction(after, { type: 'buy_clothes', item: 'cap_red' }, noon).ok).toBe(false);
  });

  it('refuses when you cannot afford it', () => {
    const broke = { ...createPlayer(), location: 'market' as const, money: 100 };
    expect(applyAction(broke, { type: 'buy_clothes', item: 'kaftan_white' }, noon).ok).toBe(false);
  });

  it('changes only at home, only into owned clothes in the right slot', () => {
    const p = { ...createPlayer(), wardrobe: [...createPlayer().wardrobe, 'shorts_denim' as const, 'cap_black' as const] };
    expect(applyAction({ ...p, location: 'market' }, { type: 'wear', slot: 'bottom', item: 'shorts_denim' }, noon).ok).toBe(false);
    expect(ok(applyAction(p, { type: 'wear', slot: 'bottom', item: 'shorts_denim' }, noon)).outfit.bottom).toBe('shorts_denim');
    expect(applyAction(p, { type: 'wear', slot: 'top', item: 'shorts_denim' }, noon).ok).toBe(false);
    expect(applyAction(p, { type: 'wear', slot: 'top', item: 'kaftan_white' }, noon).ok).toBe(false);
    const capped = ok(applyAction(p, { type: 'wear', slot: 'hat', item: 'cap_black' }, noon));
    expect(ok(applyAction(capped, { type: 'wear', slot: 'hat', item: null }, noon)).outfit.hat).toBe(null);
    expect(applyAction(p, { type: 'wear', slot: 'shoes', item: null }, noon).ok).toBe(false);
  });
});
