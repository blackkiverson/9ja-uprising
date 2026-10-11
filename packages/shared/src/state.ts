import { STARTING_MONEY, MAX_ENERGY, type FoodId, type LocationId, type WeaponId } from './data';

// One serialisable save object. In multiplayer the server holds this per player.
export interface PlayerState {
  version: 3;
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
  /** World day the player last slept, so sleep cannot be spammed. */
  lastSleptWorldDay: number | null;
  /** Busy (working, travelling) until this world minute. */
  busyUntil: number;
}

export function createPlayer(): PlayerState {
  return {
    version: 3,
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
  };
}
