// Tunable numbers for Prototype 0.1. Prices in naira.

export type LocationId = 'home' | 'office' | 'food_stall' | 'bus_stop' | 'clinic';
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
  fare: 400,
  energyCost: 5,
  durationMinutes: 45,
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

/** Mercy Clinic: pay to get health back. Full treatment takes time (skippable). */
export type TreatmentId = 'first_aid' | 'full';
export const CLINIC: Record<TreatmentId, { name: string; heal: number; price: number; minutes: number }> = {
  first_aid: { name: 'First aid', heal: 25, price: 1500, minutes: 0 },
  // Price is per health point restored, so a small top-up costs little.
  full: { name: 'Full treatment', heal: 100, price: 70, minutes: 60 },
};

/** Sleep: allowed in the evening or when exhausted, and you wake at this minute of the day. */
export const SLEEP = { from: 19 * 60, until: 5 * 60, tiredBelow: 40, wakeAt: 6 * 60 + 30 };

export const STARTING_MONEY = 10000;
export const MAX_ENERGY = 100;
