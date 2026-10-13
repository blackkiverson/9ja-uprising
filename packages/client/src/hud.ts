import { CLINIC, dailyProgress, DANFO, DANFO_ROUTES, FOOD, PARCEL, PARCEL_COLOURS, PARCEL_DROPS, skipPrice, NPCS, OFFICE_SHIFT, WEAPONS, formatClock, type Action, type ActionResult, type FoodId, type LocationId, type NpcId, type TreatmentId } from '@9ja/shared';
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
    /** Open the clothes stall (market) or the wardrobe (home). */
    private onCloset: (mode: 'shop' | 'wardrobe') => void,
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

  /** Today's task is done: a green card with the reward, in the same stack as losses. */
  dailyDone(reward: string): void {
    const el = document.createElement('div');
    el.className = 'loss gain';
    const big = document.createElement('b');
    big.textContent = 'Daily task done!';
    el.append(big, document.createTextNode(reward));
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
  /** parcel: someone at the drop-off is in reach; the next step with them (ask, hand over). */
  update(
    near: Place | null,
    npc: NpcId | null = null,
    clockMinute?: number,
    threat: { settle: number; onSettle: () => void } | null = null,
    unpaid = 0,
    parcel: { label: string; onClick: () => void } | null = null,
  ): void {
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
    $('respect').textContent = `★ ${s.respect}`;
    this.errandCard(now.totalMinutes);
    this.dailyCard();
    $('weapon').title = WEAPONS[s.weapon].name;

    const place = $('place');
    place.style.display = near || busy ? 'block' : 'none';
    place.textContent = busy ? `Busy until ${formatClock(s.busyUntil % 1440)}` : (near?.label ?? '');

    // The skip price drops as the hours tick by, so it's part of the key.
    const key = JSON.stringify([near?.id, npc, busy, s, threat !== null, busy ? skipPrice(s.busyUntil - now.totalMinutes) : 0, parcel?.label]);
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

    if (parcel) this.button(parcel.label, parcel.onClick);
    if (npc) this.button(`Talk to ${NPCS[npc].name}`, () => this.onTalk(npc));

    switch (near?.id) {
      case 'home':
        add('Sleep', { type: 'sleep' });
        this.button('👔 Wardrobe', () => this.onCloset('wardrobe'));
        break;
      case 'market':
        this.button('👕 Clothes stall', () => this.onCloset('shop'));
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

    // The dispatcher at the bus stop.
    if (near?.id === PARCEL.pickupAt) {
      if (s.errand) add('📦 Return the parcel', { type: 'return_parcel' });
      else add('📦 Run a parcel', { type: 'take_parcel' });
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

  /** Today's task: what, how far along, and the reward (or done). */
  private dailyCard(): void {
    const { task, progress, done } = dailyProgress(this.game.state, this.game.now());
    const key = `${task.id}:${progress}:${done}`;
    const card = $('daily');
    if (card.dataset.key === key) return;
    card.dataset.key = key;
    card.classList.toggle('done', done);
    card.querySelector('b')!.textContent = done ? 'Done' : 'Today';
    card.querySelector('span')!.textContent = task.goal > 1 && !done ? `${task.text} (${progress}/${task.goal})` : task.text;
    card.querySelector('small')!.textContent = done ? 'New task tomorrow' : `${naira(task.money)}${task.respect ? ` · ★ ${task.respect}` : ''}`;
  }

  /** The parcel being carried: who for, the clue, and the time left. */
  private errandCard(minute: number): void {
    const e = this.game.state.errand;
    const card = $('errand');
    card.hidden = !e;
    document.body.classList.toggle('carrying', !!e);
    if (!e) return;
    const colour = PARCEL_COLOURS[e.colour]!;
    const left = e.due - minute;
    if (card.dataset.seed !== String(e.seed)) {
      card.dataset.seed = String(e.seed);
      const clue = PARCEL_DROPS[e.to]?.clue ?? 'somewhere';
      card.querySelector('b')!.textContent = `📦 Parcel for ${e.name}`;
      card.querySelector('span')!.innerHTML = `${clue[0]!.toUpperCase()}${clue.slice(1)}. Wearing <i style="background:#${colour.hex.toString(16).padStart(6, '0')}"></i>${colour.name}.`;
    }
    card.querySelector('small')!.textContent = left >= 0 ? `${left} min left · ${naira(e.pay)}` : `Late! Half pay (${naira(Math.round(e.pay * PARCEL.latePay))})`;
    card.classList.toggle('late', left < 0);
  }

  /** A plain action-bar button that opens something rather than dispatching an action. */
  private button(label: string, onClick: () => void): void {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    $('actions').append(btn);
  }
}
