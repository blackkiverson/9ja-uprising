// Tunable numbers for Prototype 0.1. Prices in naira.

export type LocationId = 'home' | 'office' | 'food_stall' | 'bus_stop';
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

export const STARTING_MONEY = 10000;
export const MAX_ENERGY = 100;
