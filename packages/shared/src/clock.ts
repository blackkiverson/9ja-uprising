// Shared world clock (GTA Online model): everyone sees the same time and nobody can skip it.
// In 0.1 the client derives it from Date.now(); later the server is the source of truth.

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

export function worldTime(nowMs: number): WorldTime {
  const totalMinutes = Math.floor((nowMs - WORLD_EPOCH_MS) / REAL_MS_PER_GAME_MINUTE);
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
