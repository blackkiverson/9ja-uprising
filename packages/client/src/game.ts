import { applyAction, createPlayer, worldTime, type Action, type ActionResult, type PlayerState } from '@9ja/shared';

const SAVE_KEY = '9ja-save-v1';

function load(): PlayerState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlayerState | (Omit<PlayerState, 'version' | 'flags'> & { version: 1 });
      if (parsed.version === 2) return parsed;
      // v1 saves predate story flags.
      if (parsed.version === 1) return { ...parsed, version: 2, flags: {} };
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

  now() {
    return worldTime(Date.now());
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
