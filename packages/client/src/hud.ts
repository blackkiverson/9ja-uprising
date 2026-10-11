import { CLINIC, DANFO, FOOD, NPCS, OFFICE_SHIFT, WEAPONS, formatClock, type Action, type ActionResult, type FoodId, type NpcId, type TreatmentId } from '@9ja/shared';
import type { Game } from './game';
import type { Place } from './scene/world';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const naira = (n: number) => `₦${n.toLocaleString('en-GB')}`;

export class Hud {
  private toastTimer = 0;
  private lastKey = '';

  constructor(
    private game: Game,
    private onDanfo: () => void,
    private onTalk: (npc: NpcId) => void,
    /** Time was skipped (fast-forward, sleep): play the time-lapse over these minutes. */
    private onSkip: (minutes: number) => void,
  ) {}

  toast(text: string): void {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  /** Called every frame; only rebuilds the action buttons when something relevant changed. */
  /** clockMinute: the time to show (races during a time-lapse). */
  update(near: Place | null, npc: NpcId | null = null, clockMinute?: number): void {
    const s = this.game.state;
    const now = this.game.now();
    const busy = now.totalMinutes < s.busyUntil;

    // Bungee has no naira sign, so it is drawn in a font that does.
    const money = $('money');
    if (!money.firstChild) money.innerHTML = '<span class="naira">₦</span><span class="digits"></span>';
    (money.lastChild as HTMLElement).textContent = String(Math.max(0, Math.floor(s.money))).padStart(8, '0');
    const shown = clockMinute === undefined ? now.minuteOfDay : ((Math.floor(clockMinute) % 1440) + 1440) % 1440;
    const text = formatClock(shown);
    const clockEl = $('clock');
    if (clockEl.dataset.t !== text) {
      clockEl.dataset.t = text;
      clockEl.innerHTML = [...text].map((ch) => (ch === ':' ? '<span class="colon">:</span>' : `<span>${ch}</span>`)).join('');
    }
    $('day').textContent = `DAY ${s.personalDay}`;
    $('energy-fill').style.width = `${s.energy}%`;
    $('health-fill').style.width = `${s.health}%`;
    $('weapon-name').textContent = WEAPONS[s.weapon].name.toUpperCase();
    $('weapon').title = WEAPONS[s.weapon].name;

    const place = $('place');
    place.style.display = near || busy ? 'block' : 'none';
    place.textContent = busy ? `Busy until ${formatClock(s.busyUntil % 1440)}` : (near?.label ?? '');

    const key = JSON.stringify([near?.id, npc, busy, s]);
    if (key === this.lastKey) return;
    this.lastKey = key;

    const actions = $('actions');
    actions.replaceChildren();

    const add = (label: string, action: Action, after?: (r: Extract<ActionResult, { ok: true }>) => void) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const r = this.game.dispatch(action);
        if (!r.ok) this.toast(r.reason);
        else {
          if (r.message) this.toast(r.message);
          if (r.skipped) this.onSkip(r.skipped);
          after?.(r);
        }
      });
      actions.append(btn);
    };

    if (busy) {
      const label = { work: 'Fast forward to end of shift', travel: 'Skip the ride', recovering: 'Skip recovery', treatment: 'Skip treatment' }[s.busyWith ?? 'work'];
      add(`⏩ ${label}`, { type: 'fast_forward' });
      return;
    }

    if (npc) {
      const btn = document.createElement('button');
      btn.textContent = `Talk to ${NPCS[npc].name}`;
      btn.addEventListener('click', () => this.onTalk(npc));
      actions.append(btn);
    }

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
      case 'clinic': {
        const missing = 100 - s.health;
        for (const [id, t] of Object.entries(CLINIC)) {
          const price = id === 'full' ? missing * t.price : t.price;
          const heal = Math.min(t.heal, missing);
          add(missing ? `${t.name} +${heal} (${naira(price)})` : `${t.name}`, { type: 'treat', treatment: id as TreatmentId });
        }
        break;
      }
      case 'bus_stop':
        add(`Danfo to office (${naira(DANFO.fare)})`, { type: 'danfo', to: 'office' }, this.onDanfo);
        break;
    }

    for (const [id, count] of Object.entries(s.inventory)) {
      if (count) add(`Eat ${FOOD[id as FoodId].name} (${count})`, { type: 'eat', item: id as FoodId });
    }
  }
}
