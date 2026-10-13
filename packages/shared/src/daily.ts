import { SLEEP } from './data';
import type { Action } from './actions';
import type { WorldTime } from './clock';
import { seeded } from './errands';
import type { PlayerState } from './state';

// The daily task: one small goal per day, the same for everyone (picked from the world day),
// with a bonus when it's done. Progress lives in flags so saves need no upgrade.

export interface DailyTask {
  id: string;
  /** Shown on the card, e.g. "Deliver 2 parcels on time". */
  text: string;
  goal: number;
  money: number;
  respect: number;
  /** Does this action (already applied: prev to next) count towards the goal? */
  counts: (action: Action, prev: PlayerState, next: PlayerState, now: WorldTime) => boolean;
}

export const DAILY_TASKS: DailyTask[] = [
  {
    id: 'parcels', text: 'Deliver 2 parcels on time', goal: 2, money: 2000, respect: 2,
    // On time is the delivery that earned respect.
    counts: (a, prev, next) => a.type === 'deliver_parcel' && next.respect > prev.respect,
  },
  { id: 'shift', text: 'Work a shift at the office', goal: 1, money: 1000, respect: 1, counts: (a) => a.type === 'work_shift' },
  {
    id: 'rice', text: "Eat a plate of rice and stew", goal: 1, money: 500, respect: 0,
    counts: (a) => a.type === 'eat' && a.item === 'rice_and_stew',
  },
  {
    id: 'water', text: 'Buy 3 sachets of pure water', goal: 3, money: 300, respect: 0,
    counts: (a) => a.type === 'buy_food' && a.item === 'pure_water',
  },
  { id: 'market', text: 'Take a danfo to Oja market', goal: 1, money: 800, respect: 1, counts: (a) => a.type === 'danfo' && a.to === 'market' },
  { id: 'church', text: 'Stop by the church', goal: 1, money: 500, respect: 1, counts: (a) => (a.type === 'enter' || a.type === 'danfo') && (a.type === 'enter' ? a.location : a.to) === 'church' },
  { id: 'mosque', text: 'Stop by the mosque', goal: 1, money: 500, respect: 1, counts: (a) => (a.type === 'enter' || a.type === 'danfo') && (a.type === 'enter' ? a.location : a.to) === 'mosque' },
  { id: 'fresh', text: 'Buy something new to wear', goal: 1, money: 1000, respect: 1, counts: (a) => a.type === 'buy_clothes' },
  {
    id: 'bed', text: 'Be in bed before midnight', goal: 1, money: 500, respect: 0,
    counts: (a, _p, _n, now) => a.type === 'sleep' && now.minuteOfDay >= SLEEP.from,
  },
];

/**
 * Today's task, from the world day. Days run in rounds where every task comes up once, in a
 * seeded order, and a round never opens with the task the last one closed on.
 */
export function dailyTask(day: number): DailyTask {
  const n = DAILY_TASKS.length;
  const round = (r: number) => {
    const rand = seeded(r * 7919 + 17);
    const order = DAILY_TASKS.map((_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return order;
  };
  const r = Math.floor(day / n);
  const order = round(r);
  if (order[0] === round(r - 1)[n - 1]) [order[0], order[1]] = [order[1]!, order[0]!];
  return DAILY_TASKS[order[day - r * n]!]!;
}

/** Where the player stands on today's task. */
export function dailyProgress(s: PlayerState, now: WorldTime): { task: DailyTask; progress: number; done: boolean } {
  const task = dailyTask(now.day);
  const today = s.flags.daily_day === now.day;
  return { task, progress: today ? Number(s.flags.daily_progress ?? 0) : 0, done: today && s.flags.daily_done === true };
}

/**
 * After an action has gone through: count it towards today's task and pay out on completion.
 * Mutates next (a fresh copy from the rules). Returns the reward line, or null.
 */
export function trackDaily(action: Action, prev: PlayerState, next: PlayerState, now: WorldTime): string | null {
  const { task, progress, done } = dailyProgress(next, now);
  if (done || !task.counts(action, prev, next, now)) return null;
  next.flags.daily_day = now.day;
  next.flags.daily_done = false;
  next.flags.daily_progress = progress + 1;
  if (progress + 1 < task.goal) return null;
  next.flags.daily_done = true;
  next.money += task.money;
  next.respect = Math.min(100, next.respect + task.respect);
  return `+₦${task.money.toLocaleString('en-GB')}${task.respect ? `, +${task.respect} respect` : ''}`;
}
