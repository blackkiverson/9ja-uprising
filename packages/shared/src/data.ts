// Tunable numbers for Prototype 0.1. Prices in naira.

export type LocationId = 'home' | 'office' | 'food_stall' | 'bus_stop' | 'clinic' | 'church' | 'mosque' | 'market';
export type WeaponId = 'fist';

export const WEAPONS: Record<WeaponId, { name: string }> = {
  fist: { name: 'Fist' },
};

export type FoodId = 'puff_puff' | 'gala' | 'rice_and_stew' | 'pure_water';

export interface FoodItem {
  name: string;
  price: number;
  energy: number;
}

export const FOOD: Record<FoodId, FoodItem> = {
  pure_water: { name: 'Pure water', price: 50, energy: 3 },
  puff_puff: { name: 'Puff-puff', price: 200, energy: 8 },
  gala: { name: 'Gala', price: 300, energy: 10 },
  rice_and_stew: { name: 'Rice and stew', price: 1500, energy: 35 },
};

export const OFFICE_SHIFT = {
  pay: 6000,
  energyCost: 35,
  durationMinutes: 8 * 60,
  startsFrom: 7 * 60,
  latestStart: 10 * 60,
};

export const DANFO = {
  energyCost: 5,
  /** Where you can board: the hub bus stop and the market's motor park. */
  boardAt: ['bus_stop', 'market'] as LocationId[],
};

/** Danfo routes: fare and ride time to each key place (the far-side market costs more). */
export const DANFO_ROUTES: Partial<Record<LocationId, { name: string; fare: number; minutes: number }>> = {
  home: { name: 'Home', fare: 200, minutes: 15 },
  office: { name: 'Work', fare: 300, minutes: 25 },
  clinic: { name: 'Clinic', fare: 300, minutes: 20 },
  church: { name: 'Church', fare: 200, minutes: 15 },
  mosque: { name: 'Mosque', fare: 200, minutes: 15 },
  market: { name: 'Market', fare: 500, minutes: 45 },
  bus_stop: { name: 'Bus stop', fare: 500, minutes: 45 },
};

// Nobody brakes for pedestrians. Damage at full speed; slower hits scale down.
export type VehicleKind = 'car' | 'danfo' | 'keke';
export const VEHICLE_HIT: Record<VehicleKind, { name: string; damage: number; topSpeed: number }> = {
  keke: { name: 'Keke', damage: 12, topSpeed: 5.5 },
  car: { name: 'Car', damage: 20, topSpeed: 8.5 },
  danfo: { name: 'Danfo', damage: 28, topSpeed: 7 },
};
/** Below this speed (m/s) a vehicle only shoves you aside. */
export const HIT_MIN_SPEED = 1.5;
/** Health hits zero: you wake up at the clinic, patched up, with a bill. */
export const KNOCKOUT = { health: 50, bill: 2500, minutes: 120 };

/**
 * Agberos at night: pay them off ("settle") and they leave you alone till morning. Get too close
 * without paying and they either shove you to the ground (health) or go through your pockets.
 */
export const AGBERO = { settle: 500, damage: 10, snatch: 800 };

/** What agberos shout. Draft Pidgin: needs a native speaker's pass. */
export const AGBERO_LINES = {
  approach: ['Oga mi! Where you dey go?', 'Bros, drop something for the boys', 'Na our area be this o!', 'Chairman, wetin you carry?', 'You no fit pass like that', 'Owo da? Settle us!'],
  grip: ['Drop something now now!', 'You dey hear me? Bring am!', 'No dey form for us!', 'Shey you wan try us?'],
  push: ['You think say na joke?', 'Comot for road!', 'Na so we dey do am here!'],
  rob: ['Oya check im pocket!', 'Bring that thing!', 'Thank you sir!'],
  settled: ['Correct guy! Waka pass.', 'Baba God bless you!', 'Chairman! Anytime, anytime.'],
  gaveUp: ['Run! We go see you!', 'You go come back!', 'Coward! Na una dey run.'],
};

/** Mercy Clinic: pay to get health back. Full treatment takes time (skippable). */
export type TreatmentId = 'first_aid' | 'full';
export const CLINIC: Record<TreatmentId, { name: string; heal: number; price: number; minutes: number }> = {
  first_aid: { name: 'First aid', heal: 25, price: 1500, minutes: 0 },
  // Price is per health point restored, so a small top-up costs little.
  full: { name: 'Full treatment', heal: 100, price: 70, minutes: 60 },
};

/** Skipping time you're busy for costs money: per started hour skipped, with a floor. */
export const FAST_FORWARD = { perHour: 300, min: 100 };

/** Price to skip the rest of whatever you're busy with. */
export function skipPrice(minutesLeft: number): number {
  return Math.max(FAST_FORWARD.min, Math.ceil(minutesLeft / 60) * FAST_FORWARD.perHour);
}

/** Sleep: allowed in the evening or when exhausted, and you wake at this minute of the day. */
export const SLEEP = { from: 19 * 60, until: 5 * 60, tiredBelow: 40, wakeAt: 6 * 60 + 30 };

export const STARTING_MONEY = 10000;
export const MAX_ENERGY = 100;
