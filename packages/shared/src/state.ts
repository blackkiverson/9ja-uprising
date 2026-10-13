import type { Errand } from './errands';
import { STARTER_OUTFIT, STARTER_WARDROBE, type ClothingId, type WornOutfit } from './clothes';
import { STARTING_MONEY, MAX_ENERGY, type FoodId, type LocationId, type WeaponId } from './data';

// One serialisable save object. In multiplayer the server holds this per player.
export interface PlayerState {
  version: 6;
  money: number;
  energy: number;
  /** 0-100. Unused until fights, injuries and police arrive. */
  health: number;
  /** Equipped weapon. Everyone starts with their fists. */
  weapon: WeaponId;
  location: LocationId;
  inventory: Partial<Record<FoodId, number>>;
  /** Clothes owned, and what's on right now. */
  wardrobe: ClothingId[];
  outfit: WornOutfit;
  /** 0-100: how the streets see you. Earned by keeping your word and helping people. */
  respect: number;
  /** The parcel you're carrying, if any. */
  errand: Errand | null;
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

export type BusyWith = 'work' | 'travel' | 'recovering' | 'treatment';

export function createPlayer(): PlayerState {
  return {
    version: 6,
    money: STARTING_MONEY,
    energy: MAX_ENERGY,
    health: 100,
    weapon: 'fist',
    location: 'home',
    inventory: {},
    wardrobe: [...STARTER_WARDROBE],
    outfit: { ...STARTER_OUTFIT },
    respect: 0,
    errand: null,
    relationships: {},
    flags: {},
    personalDay: 1,
    lastSleptWorldDay: null,
    busyUntil: 0,
    busyWith: null,
    timeOffset: 0,
  };
}
