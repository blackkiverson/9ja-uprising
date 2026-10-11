import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { MINUTES_PER_DAY, type WorldTime } from './clock';
import { checkChoice, greetingNode } from './dialogue';
import { NPCS } from './npcs';
import { createPlayer, type PlayerState } from './state';

const at = (day: number, minuteOfDay = 600): WorldTime => ({ day, minuteOfDay, totalMinutes: day * MINUTES_PER_DAY + minuteOfDay });
const ok = (r: ReturnType<typeof applyAction>): PlayerState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe('dialogue', () => {
  it('every choice points at a node that exists', () => {
    for (const npc of Object.values(NPCS)) {
      for (const g of npc.greetings) expect(npc.nodes[g.node], `${npc.id} greeting ${g.node}`).toBeDefined();
      for (const [id, node] of Object.entries(npc.nodes)) {
        for (const c of node.choices) if (c.next) expect(npc.nodes[c.next], `${npc.id}.${id} -> ${c.next}`).toBeDefined();
      }
    }
  });

  it('raises relationship once per world day', () => {
    const p = createPlayer();
    const a = ok(applyAction(p, { type: 'dialogue', npc: 'mama_nkechi', node: 'hello', choice: 1 }, at(1)));
    expect(a.relationships.mama_nkechi).toBe(5);
    expect(applyAction(a, { type: 'dialogue', npc: 'mama_nkechi', node: 'hello', choice: 1 }, at(1)).ok).toBe(false);
    expect(ok(applyAction(a, { type: 'dialogue', npc: 'mama_nkechi', node: 'hello', choice: 1 }, at(2))).relationships.mama_nkechi).toBe(10);
  });

  it('switches greeting with relationship', () => {
    const p = createPlayer();
    expect(greetingNode(p, 'mama_nkechi')).toBe('hello');
    expect(greetingNode({ ...p, relationships: { mama_nkechi: 30 } }, 'mama_nkechi')).toBe('regular');
  });

  it('explains why a choice is locked and hides story-gated ones', () => {
    const p = createPlayer();
    const credit = checkChoice(p, 'mama_nkechi', 'regular', 1, at(1));
    expect(credit).toMatchObject({ ok: false, hidden: false });
    const repay = checkChoice(p, 'mama_nkechi', 'hello', 0, at(1));
    expect(repay).toMatchObject({ ok: false, hidden: true });
  });

  it('takes a salary advance back out of the next shift', () => {
    let p: PlayerState = { ...createPlayer(), relationships: { oga_bayo: 50 }, location: 'office' };
    p = ok(applyAction(p, { type: 'dialogue', npc: 'oga_bayo', node: 'trusted', choice: 0 }, at(1)));
    expect(p.money).toBe(15000);
    p = ok(applyAction(p, { type: 'work_shift' }, at(2, 8 * 60)));
    expect(p.money).toBe(15000 + 6000 - 5000);
    expect(p.flags.oga_advance).toBe(false);
  });

  it('helping the neighbour costs energy and gives a Gala', () => {
    const p = ok(applyAction(createPlayer(), { type: 'dialogue', npc: 'mallam_sani', node: 'help', choice: 0 }, at(1)));
    expect(p.energy).toBe(85);
    expect(p.inventory.gala).toBe(1);
    expect(p.relationships.mallam_sani).toBe(10);
  });
});
