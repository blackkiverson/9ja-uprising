import { applyAction, createPlayer, exactMinutes, worldTime, type Action, type ActionResult, type PlayerState } from '@9ja/shared';

const SAVE_KEY = '9ja-save-v1';

function load(): PlayerState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Omit<PlayerState, 'version'>> & { version?: number };
      // Older saves: v1 predates story flags, v2 health and weapons, v3 the personal clock.
      if (parsed.version !== undefined && parsed.version >= 1 && parsed.version <= 4) {
        return { ...createPlayer(), ...parsed, flags: parsed.flags ?? {}, version: 4 } as PlayerState;
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
    }
    return result;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }
}
