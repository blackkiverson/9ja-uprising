import type { WorldTime } from './clock';
import { FOOD, type FoodId, type LocationId } from './data';
import type { PlayerState } from './state';
import { NPCS } from './npcs';

export type NpcId = 'mama_nkechi' | 'oga_bayo' | 'tunde' | 'mallam_sani' | 'kelz';

export type Condition =
  | { kind: 'money'; min: number }
  | { kind: 'energy'; min: number }
  /** Relationship with the NPC you are talking to. */
  | { kind: 'relationship'; min: number }
  /** Story gate: hidden unless the flag matches. */
  | { kind: 'flag'; key: string; is: boolean };

export type Effect =
  | { kind: 'money'; delta: number }
  | { kind: 'energy'; delta: number }
  | { kind: 'relationship'; delta: number }
  | { kind: 'item'; item: FoodId; delta: number }
  | { kind: 'flag'; key: string; value: boolean };

export interface Choice {
  text: string;
  /** Next node; omit to end the conversation. */
  next?: string;
  requires?: Condition[];
  effects?: Effect[];
  /** Can only be picked once per world day (stops relationship farming). */
  oncePerDay?: boolean;
}

export interface DialogueNode {
  text: string;
  choices: Choice[];
}

export interface Npc {
  id: NpcId;
  name: string;
  role: string;
  /** Where they hang about (used for flavour and later for server-side position checks). */
  near: LocationId;
  /** Opening node: the highest relationship threshold you meet wins. */
  greetings: { minRelationship: number; node: string }[];
  nodes: Record<string, DialogueNode>;
}

export type ChoiceCheck = { ok: true } | { ok: false; reason: string; hidden: boolean };

const naira = (n: number) => `₦${n.toLocaleString('en-GB')}`;
const onceKey = (npc: NpcId, node: string, index: number) => `once:${npc}:${node}:${index}`;

export function relationshipWith(state: PlayerState, npc: NpcId): number {
  return state.relationships[npc] ?? 0;
}

export function greetingNode(state: PlayerState, npc: NpcId): string {
  const rel = relationshipWith(state, npc);
  const options = [...NPCS[npc].greetings].sort((a, b) => b.minRelationship - a.minRelationship);
  return (options.find((g) => rel >= g.minRelationship) ?? options[options.length - 1]!).node;
}

/** Whether a choice can be picked now, and if not, a reason the player can read. */
export function checkChoice(state: PlayerState, npc: NpcId, node: string, index: number, now: WorldTime): ChoiceCheck {
  const choice = NPCS[npc].nodes[node]?.choices[index];
  if (!choice) return { ok: false, reason: 'That option does not exist.', hidden: true };
  for (const c of choice.requires ?? []) {
    if (c.kind === 'flag' && (state.flags[c.key] === true) !== c.is) return { ok: false, reason: '', hidden: true };
    if (c.kind === 'money' && state.money < c.min) return { ok: false, reason: `Needs ${naira(c.min)}`, hidden: false };
    if (c.kind === 'energy' && state.energy < c.min) return { ok: false, reason: `Needs ${c.min} energy`, hidden: false };
    if (c.kind === 'relationship' && relationshipWith(state, npc) < c.min) {
      return { ok: false, reason: `${NPCS[npc].name} needs to trust you more (${relationshipWith(state, npc)}/${c.min})`, hidden: false };
    }
  }
  if (choice.oncePerDay && state.flags[onceKey(npc, node, index)] === now.day) {
    return { ok: false, reason: 'Done today', hidden: false };
  }
  return { ok: true };
}

/** Applies a choice's effects to a (cloned) state. Returns a short summary for the toast. */
export function applyChoice(s: PlayerState, npc: NpcId, node: string, index: number, now: WorldTime): string {
  const choice = NPCS[npc].nodes[node]!.choices[index]!;
  const parts: string[] = [];
  for (const e of choice.effects ?? []) {
    switch (e.kind) {
      case 'money':
        s.money += e.delta;
        parts.push(`${e.delta > 0 ? '+' : '-'}${naira(Math.abs(e.delta))}`);
        break;
      case 'energy':
        s.energy = Math.max(0, Math.min(100, s.energy + e.delta));
        parts.push(`${e.delta > 0 ? '+' : ''}${e.delta} energy`);
        break;
      case 'relationship': {
        const before = relationshipWith(s, npc);
        s.relationships[npc] = Math.max(-100, Math.min(100, before + e.delta));
        parts.push(`${NPCS[npc].name} ${e.delta > 0 ? '+' : ''}${e.delta}`);
        break;
      }
      case 'item':
        s.inventory[e.item] = Math.max(0, (s.inventory[e.item] ?? 0) + e.delta);
        parts.push(`${e.delta > 0 ? '+' : ''}${e.delta} ${FOOD[e.item].name}`);
        break;
      case 'flag':
        s.flags[e.key] = e.value;
        break;
    }
  }
  if (choice.oncePerDay) s.flags[onceKey(npc, node, index)] = now.day;
  return parts.join(' · ');
}
