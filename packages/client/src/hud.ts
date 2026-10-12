import { CLINIC, DANFO, DANFO_ROUTES, FOOD, skipPrice, NPCS, OFFICE_SHIFT, WEAPONS, formatClock, type Action, type ActionResult, type FoodId, type LocationId, type NpcId, type TreatmentId } from '@9ja/shared';
import type { Game } from './game';
import type { Place } from './scene/world';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const naira = (n: number) => `₦${n.toLocaleString('en-GB')}`;

export class Hud {
  private toastTimer = 0;
  private lastKey = '';

  constructor(
    private game: Game,
    private onDanfo: (to: LocationId) => void,
    private onTalk: (npc: NpcId) => void,
    /** Time was skipped (fast-forward, sleep): play the time-lapse over these minutes. */
    private onSkip: (minutes: number) => void,
  ) {}

  /**
   * Something taken from you: a card under the status that stacks with others and goes after
   * 10 s. amount is shown big (e.g. ₦800, 10 health), why underneath.
   */
  loss(kind: 'money' | 'health', amount: number, why: string): void {
    const el = document.createElement('div');
    el.className = `loss ${kind}`;
    const big = document.createElement('b');
    if (kind === 'money') big.innerHTML = `-<span class="naira">₦</span>${amount.toLocaleString('en-GB')}`;
    else big.textContent = `-${amount} health`;
    el.append(big, document.createTextNode(why));
    $('losses').append(el);
    window.setTimeout(() => el.remove(), 10_000);
  }

  toast(text: string): void {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  /** Called every frame; only rebuilds the action buttons when something relevant changed. */
  /** clockMinute: the time to show (races during a time-lapse). */
  /** threat: agberos are on you; offers a button to settle them. unpaid: wages held back from the display. */
  update(near: Place | null, npc: NpcId | null = null, clockMinute?: number, threat: { settle: number; onSettle: () => void } | null = null, unpaid = 0): void {
    const s = this.game.state;
    const now = this.game.now();
    const busy = now.totalMinutes < s.busyUntil;

    // Bungee has no naira sign, so it is drawn in a font that does.
    const money = $('money');
    if (!money.firstChild) money.innerHTML = '<span class="naira">₦</span><span class="digits"></span>';
    (money.lastChild as HTMLElement).textContent = String(Math.max(0, Math.floor(s.money - unpaid))).padStart(8, '0');
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

    // The skip price drops as the hours tick by, so it's part of the key.
    const key = JSON.stringify([near?.id, npc, busy, s, threat !== null, busy ? skipPrice(s.busyUntil - now.totalMinutes) : 0]);
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

    if (threat) {
      const btn = document.createElement('button');
      btn.className = 'danger';
      btn.textContent = `💸 Settle them (${naira(threat.settle)})`;
      btn.addEventListener('click', threat.onSettle);
      actions.append(btn);
    }

    if (busy) {
      const label = { work: 'Fast forward to end of shift', travel: 'Skip the ride', recovering: 'Skip recovery', treatment: 'Skip treatment' }[s.busyWith ?? 'work'];
      add(`⏩ ${label} (${naira(skipPrice(s.busyUntil - now.totalMinutes))})`, { type: 'fast_forward' });
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
    }

    // Danfo park: a ride to every key place on the planet.
    if (near && DANFO.boardAt.includes(near.id)) {
      for (const [to, route] of Object.entries(DANFO_ROUTES)) {
        if (to === near.id) continue;
        add(`🚐 ${route.name} (${naira(route.fare)})`, { type: 'danfo', to: to as LocationId }, () => this.onDanfo(to as LocationId));
      }
    }

    for (const [id, count] of Object.entries(s.inventory)) {
      if (count) add(`Eat ${FOOD[id as FoodId].name} (${count})`, { type: 'eat', item: id as FoodId });
    }
  }
}
