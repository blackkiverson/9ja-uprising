// Clothes: every item a player can own and wear. Styles are the shapes the client knows how to
// build; colours are what make an item. Prices in naira.

export type HairStyle = 'afro' | 'low' | 'puff' | 'braids' | 'bald';
export type TopStyle = 'tee' | 'singlet' | 'shirt' | 'buba' | 'kaftan';
export type BottomStyle = 'trousers' | 'shorts' | 'wrapper';
export type ShoeStyle = 'slippers' | 'sneakers' | 'sandals' | 'shoes';
export type HatStyle = 'cap' | 'fila' | 'kufi' | 'headtie' | 'beanie';

export interface StyleOf {
  top: TopStyle;
  bottom: BottomStyle;
  shoes: ShoeStyle;
  hat: HatStyle;
}
export type ClothingSlot = keyof StyleOf;

export interface ClothingItem<S extends ClothingSlot = ClothingSlot> {
  name: string;
  slot: S;
  style: StyleOf[S];
  color: number;
  /** Trim: collars, soles, bands, embroidery. */
  accent?: number;
  price: number;
}

const item = <S extends ClothingSlot>(slot: S, style: StyleOf[S], name: string, price: number, color: number, accent?: number): ClothingItem<S> =>
  accent === undefined ? { name, slot, style, color, price } : { name, slot, style, color, accent, price };

/** The market's stock, cheapest first within each slot. Okrika (second-hand) up to proper aso-ebi. */
export const CLOTHES = {
  // Tops
  tee_green: item('top', 'tee', 'Green tee', 2000, 0x2e7d5b),
  singlet_white: item('top', 'singlet', 'White singlet', 1500, 0xe9ecdf),
  singlet_black: item('top', 'singlet', 'Black singlet', 1500, 0x2b2f30),
  tee_red: item('top', 'tee', 'Red tee', 2500, 0xc9584d),
  tee_yellow: item('top', 'tee', 'Yellow tee', 2500, 0xd9b44a),
  tee_black: item('top', 'tee', 'Black tee', 2500, 0x2b2f30),
  shirt_blue: item('top', 'shirt', 'Office shirt, blue', 6500, 0xd9e4ee, 0x34465e),
  shirt_white: item('top', 'shirt', 'Office shirt, white', 6500, 0xf4f1e6, 0x8a7b6a),
  buba_gold: item('top', 'buba', 'Gold buba', 16000, 0xd9b44a, 0x7a3b2e),
  buba_blue: item('top', 'buba', 'Royal blue buba', 16000, 0x3456a0, 0xe9ecdf),
  kaftan_white: item('top', 'kaftan', 'White kaftan', 18000, 0xeef0e6, 0xb9b3a0),
  kaftan_green: item('top', 'kaftan', 'Green kaftan', 18000, 0x2e6b4a, 0xd9b44a),
  // Bottoms
  trousers_navy: item('bottom', 'trousers', 'Navy trousers', 4000, 0x34465e),
  shorts_denim: item('bottom', 'shorts', 'Denim shorts', 3000, 0x5b8fb0),
  shorts_black: item('bottom', 'shorts', 'Black shorts', 3000, 0x2b2f30),
  trousers_black: item('bottom', 'trousers', 'Black trousers', 5000, 0x2c2f38),
  trousers_khaki: item('bottom', 'trousers', 'Khaki trousers', 5000, 0xb8a27a),
  trousers_white: item('bottom', 'trousers', 'White trousers', 6000, 0xeef0e6),
  wrapper_ankara: item('bottom', 'wrapper', 'Ankara wrapper', 7500, 0xc9584d, 0xd9b44a),
  // Shoes
  slippers_black: item('shoes', 'slippers', 'Black slippers', 800, 0x283130),
  slippers_blue: item('shoes', 'slippers', 'Blue slippers', 800, 0x3456a0),
  sandals_brown: item('shoes', 'sandals', 'Leather sandals', 6000, 0x7a4a2a),
  sneakers_red: item('shoes', 'sneakers', 'Red sneakers', 9000, 0xc9584d, 0xf4f1e6),
  sneakers_white: item('shoes', 'sneakers', 'White sneakers', 12000, 0xf4f1e6, 0x2b2f30),
  shoes_brown: item('shoes', 'shoes', 'Brown shoes', 14000, 0x3a2618),
  shoes_black: item('shoes', 'shoes', 'Black shoes', 14000, 0x1f1f22),
  // Hats
  beanie_black: item('hat', 'beanie', 'Black beanie', 1500, 0x2b2f30),
  cap_black: item('hat', 'cap', 'Black cap', 2000, 0x283130),
  cap_red: item('hat', 'cap', 'Red cap', 2000, 0xc9584d),
  kufi_white: item('hat', 'kufi', 'White kufi', 3500, 0xd8d3c4),
  fila_wine: item('hat', 'fila', 'Wine fila', 4000, 0x7a3b2e),
  headtie_gold: item('hat', 'headtie', 'Gold gele', 4500, 0xd9b44a),
} satisfies Record<string, ClothingItem>;

export type ClothingId = keyof typeof CLOTHES;

/** What a player has on. Hat is optional; everything else is always worn. */
export interface WornOutfit {
  top: ClothingId;
  bottom: ClothingId;
  shoes: ClothingId;
  hat: ClothingId | null;
}

export const STARTER_OUTFIT: WornOutfit = { top: 'tee_green', bottom: 'trousers_navy', shoes: 'slippers_black', hat: null };
export const STARTER_WARDROBE: ClothingId[] = ['tee_green', 'trousers_navy', 'slippers_black'];

export function isClothingId(id: string): id is ClothingId {
  return id in CLOTHES;
}
