import { STARTING_MONEY, MAX_ENERGY, type FoodId, type LocationId, type WeaponId } from './data';

// One serialisable save object. In multiplayer the server holds this per player.
export interface PlayerState {
  version: 4;
  money: number;
  energy: number;
  /** 0-100. Unused until fights, injuries and police arrive. */
  health: number;
  /** Equipped weapon. Everyone starts with their fists. */
  weapon: WeaponId;
  location: LocationId;
  inventory: Partial<Record<FoodId, number>>;
  relationships: Record<string, number>;
  /** Story flags and once-per-day markers (value = world day). */
  flags: Record<string, boolean | number>;
  /** Personal days lived: increments on each sleep. Progress is measured in these, not world days. */
  personalDay: number;
  /** Day the player last went to sleep (small hours count as the night before). */
  lastSleptWorldDay: number | null;
  /** Busy (working, travelling) until this personal minute. */
  busyUntil: number;
  /** What the player is busy with, so the client can show it (only meaningful while busy). */
  busyWith: BusyWith | null;
  /** Game minutes the player's personal clock runs ahead of the world clock. Only grows. */
  timeOffset: number;
}

export type BusyWith = 'work' | 'travel' | 'recovering';

export function createPlayer(): PlayerState {
  return {
    version: 4,
    money: STARTING_MONEY,
    energy: MAX_ENERGY,
    health: 100,
    weapon: 'fist',
    location: 'home',
    inventory: {},
    relationships: {},
    flags: {},
    personalDay: 1,
    lastSleptWorldDay: null,
    busyUntil: 0,
    busyWith: null,
    timeOffset: 0,
  };
}
