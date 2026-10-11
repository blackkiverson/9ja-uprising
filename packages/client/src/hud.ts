import { DANFO, FOOD, OFFICE_SHIFT, formatClock, type Action, type FoodId } from '@9ja/shared';
import type { Game } from './game';
import type { Place } from './scene/world';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const naira = (n: number) => `₦${n.toLocaleString('en-GB')}`;

export class Hud {
  private toastTimer = 0;
  private lastKey = '';

  constructor(private game: Game, private onDanfo: () => void) {}

  toast(text: string): void {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  /** Called every frame; only rebuilds the action buttons when something relevant changed. */
  update(near: Place | null): void {
    const s = this.game.state;
    const now = this.game.now();
    const busy = now.totalMinutes < s.busyUntil;

    $('money').textContent = naira(s.money);
    $('energy').textContent = `Energy ${s.energy}`;
    $('clock').textContent = formatClock(now.minuteOfDay);
    $('day').textContent = `Day ${s.personalDay}`;

    const place = $('place');
    place.style.display = near || busy ? 'block' : 'none';
    place.textContent = busy ? `Busy until ${formatClock(s.busyUntil % 1440)}` : (near?.label ?? '');

    const key = JSON.stringify([near?.id, busy, s]);
    if (key === this.lastKey) return;
    this.lastKey = key;

    const actions = $('actions');
    actions.replaceChildren();
    if (busy) return;

    const add = (label: string, action: Action, after?: () => void) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const r = this.game.dispatch(action);
        if (!r.ok) this.toast(r.reason);
        else {
          if (r.message) this.toast(r.message);
          after?.();
        }
      });
      actions.append(btn);
    };

    switch (near?.id) {
      case 'home':
        add('Sleep', { type: 'sleep' });
        break;
      case 'office':
        add(`Work shift (+${naira(OFFICE_SHIFT.pay)})`, { type: 'work_shift' });
        break;
      case 'food_stall':
        for (const [id, f] of Object.entries(FOOD)) {
          add(`${f.name} ${naira(f.price)}`, { type: 'buy_food', item: id as FoodId });
        }
        break;
      case 'bus_stop':
        add(`Danfo to office (${naira(DANFO.fare)})`, { type: 'danfo', to: 'office' }, this.onDanfo);
        break;
    }

    for (const [id, count] of Object.entries(s.inventory)) {
      if (count) add(`Eat ${FOOD[id as FoodId].name} (${count})`, { type: 'eat', item: id as FoodId });
    }
  }
}
