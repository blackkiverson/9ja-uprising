import { applyAction, createPlayer, exactMinutes, worldTime, type Action, type ActionResult, type PlayerState } from '@9ja/shared';

const SAVE_KEY = '9ja-save-v1';

function load(): PlayerState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Omit<PlayerState, 'version'>> & { version?: number };
      // Older saves: v1 predates story flags, v2 health and weapons, v3 the personal clock, v4 clothes, v5 respect and parcels.
      if (parsed.version !== undefined && parsed.version >= 1 && parsed.version <= 6) {
        return { ...createPlayer(), ...parsed, flags: parsed.flags ?? {}, version: 6 } as PlayerState;
      }
    }
  } catch {
    // Storage blocked or corrupt save: start fresh.
  }
  return createPlayer();
}

/**
 * Local stand-in for the future server: holds state and runs every action through the shared rules.
 * When multiplayer lands, dispatch() sends the action to Colyseus instead.
 */
export class Game {
  state: PlayerState = load();
  private listeners = new Set<() => void>();
  private dailyListeners = new Set<(reward: string) => void>();

  /** The player's personal time: world clock plus their offset. */
  now() {
    return worldTime(Date.now(), this.state.timeOffset);
  }

  /** Fractional personal minutes, for smooth lighting. */
  exactNow() {
    return exactMinutes(Date.now(), this.state.timeOffset);
  }

  dispatch(action: Action): ActionResult {
    const result = applyAction(this.state, action, this.now());
    if (result.ok) {
      this.state = result.state;
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
      } catch {
        // Ignore: the game still runs without persistence.
      }
      this.listeners.forEach((fn) => fn());
      if (result.daily) this.dailyListeners.forEach((fn) => fn(result.daily!));
    }
    return result;
  }

  /**
   * Testing aid (?time=07:00): move the personal clock forward to the next given time of day.
   * Forward only, like every other skip. Not a rule: the multiplayer server won't offer it.
   */
  skipTo(minuteOfDay: number): number {
    const minutes = (((minuteOfDay - this.now().minuteOfDay) % 1440) + 1440) % 1440;
    this.state = { ...this.state, timeOffset: this.state.timeOffset + minutes };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore: the game still runs without persistence.
    }
    this.listeners.forEach((fn) => fn());
    return minutes;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** Today's task was just completed; reward is the line to show. */
  onDaily(fn: (reward: string) => void): void {
    this.dailyListeners.add(fn);
  }
}
