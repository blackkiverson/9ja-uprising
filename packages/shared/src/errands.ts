import type { LocationId } from './data';

// Parcel runs: pick up at the bus stop, then find the one person waiting for it from a vague
// clue. A few people hang about the drop-off; only one is expecting a parcel.

export const PARCEL = {
  /** Where the dispatcher hands out parcels. */
  pickupAt: 'bus_stop' as LocationId,
  energyCost: 8,
  /** People standing about at the drop-off, one of them the recipient. */
  crowd: 5,
  /** Parcels the dispatcher has per day. */
  perDay: 4,
  /** Late deliveries pay this share. */
  latePay: 0.5,
};

/** Drop-offs: the clue you get, the fee, and how long you have (game minutes; one is 2 real seconds). */
export const PARCEL_DROPS: Partial<Record<LocationId, { clue: string; pay: number; minutes: number }>> = {
  food_stall: { clue: "close to Mama Put's stall", pay: 600, minutes: 25 },
  home: { clue: 'on your own street, near your compound', pay: 600, minutes: 25 },
  office: { clue: 'near the office on Bode Thomas', pay: 700, minutes: 30 },
  church: { clue: 'next to the church', pay: 800, minutes: 30 },
  mosque: { clue: 'by the mosque', pay: 800, minutes: 30 },
  clinic: { clue: 'around Mercy Clinic', pay: 900, minutes: 35 },
  market: { clue: 'somewhere in Oja market park', pay: 1200, minutes: 45 },
};

/** Top colours people wear; the recipient's is part of the clue. */
export const PARCEL_COLOURS = [
  { name: 'red', hex: 0xc9584d },
  { name: 'yellow', hex: 0xd9b44a },
  { name: 'white', hex: 0xe9ecdf },
  { name: 'blue', hex: 0x3456a0 },
  { name: 'green', hex: 0x2e7d5b },
  { name: 'black', hex: 0x2b2f30 },
  { name: 'purple', hex: 0x8e5bb5 },
  { name: 'orange', hex: 0xd9773a },
] as const;

const NAMES = ['Emeka', 'Chioma', 'Musa', 'Funke', 'Uche', 'Bisi', 'Tobi', 'Aisha', 'Kunle', 'Ngozi', 'Sade', 'Ibrahim'];

export interface Errand {
  to: LocationId;
  /** Seeds the crowd at the drop-off (who stands where, what they wear). */
  seed: number;
  /** Which of the crowd is the recipient. */
  who: number;
  name: string;
  /** Index into PARCEL_COLOURS: the recipient's top. */
  colour: number;
  pay: number;
  /** Personal minute it's due by. */
  due: number;
}

/** What people say when it isn't them. Draft Pidgin: needs a native speaker's pass. */
export const PARCEL_LINES = {
  wrong: ['No be me o.', 'Which parcel? I no order anything.', 'Parcel? I wish!', 'Na me? No o. Ask that one.', 'Abeg, I dey busy.', 'My brother, e no be me.', 'I no dey expect anything.'],
  right: 'Are you the one with the parcel?',
  thanks: ['Thank you! Tell your oga I don collect am.', 'Finally! God bless you.', 'Correct! Na this one I dey wait for.'],
  late: ['Ehen! You don come? I don wait tire.', 'Na now you reach? Hmm. Give me.'],
};

/** Small seeded generator (mulberry32), so a server can rebuild the same errand. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new parcel from the dispatcher: where it goes, who it's for, by when. */
export function newErrand(seed: number, now: number): Errand {
  const r = seeded(seed);
  const drops = Object.keys(PARCEL_DROPS) as LocationId[];
  const to = drops[Math.floor(r() * drops.length)]!;
  const drop = PARCEL_DROPS[to]!;
  return {
    to,
    seed,
    who: Math.floor(r() * PARCEL.crowd),
    name: NAMES[Math.floor(r() * NAMES.length)]!,
    colour: Math.floor(r() * PARCEL_COLOURS.length),
    pay: drop.pay,
    due: now + drop.minutes,
  };
}

/** The clue as the dispatcher says it. */
export function errandClue(e: Errand): string {
  return `${PARCEL_DROPS[e.to]?.clue ?? 'somewhere'}, wearing ${PARCEL_COLOURS[e.colour]?.name ?? 'something'}`;
}
