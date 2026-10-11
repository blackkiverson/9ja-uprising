// World clock: runs in real time for everyone. Each player then lives on a personal clock,
// the world clock plus a forward-only offset gained by skipping time (fast-forwarding a shift,
// sleeping to morning). Single-player GTA feel; in multiplayer the server keeps each offset.

export const REAL_MS_PER_GAME_MINUTE = 2000; // 1 game day = 48 real minutes
export const MINUTES_PER_DAY = 24 * 60;

// Fixed epoch so every client and the server agree on the same world time.
const WORLD_EPOCH_MS = Date.UTC(2026, 9, 1);

export interface WorldTime {
  /** Total game minutes since the world began. */
  totalMinutes: number;
  /** World day number, shared by all players. */
  day: number;
  /** Minutes since midnight, 0 to 1439. */
  minuteOfDay: number;
}

/** Exact (fractional) game minutes, for smooth sky and lighting. */
export function exactMinutes(nowMs: number, offsetMinutes = 0): number {
  return (nowMs - WORLD_EPOCH_MS) / REAL_MS_PER_GAME_MINUTE + offsetMinutes;
}

/** offsetMinutes: the player's personal lead on the world clock (0 = world time). */
export function worldTime(nowMs: number, offsetMinutes = 0): WorldTime {
  return timeAt(Math.floor(exactMinutes(nowMs)) + offsetMinutes);
}

export function timeAt(totalMinutes: number): WorldTime {
  return {
    totalMinutes,
    day: Math.floor(totalMinutes / MINUTES_PER_DAY),
    minuteOfDay: ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
  };
}

export function formatClock(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
