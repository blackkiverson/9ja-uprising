/**
 * First-time info cards for the game's features. Each shows when its feature first comes up;
 * "Don't show me this again" retires it for good, otherwise it may return in a later session.
 * Kept in this browser only: it's a viewing preference, not game progress.
 */
export const TIPS = {
  move: { title: 'Getting about', body: 'Walk with WASD or the arrow keys, or tap/click where you want to go. Space jumps.' },
  talk: { title: 'Talking to people', body: 'Some people have names over their heads. Get close and press E, or tap Talk, to chat.' },
  danfo: { title: 'Danfo park', body: 'Pick where you want to go and pay the fare. The danfo fills up, then drives you through traffic. Stuck in a go-slow? Skip the ride.' },
  work: { title: 'Work', body: 'Shifts start between 07:00 and 10:00 and pay ₦6,000. You can fast forward to the end of a shift.' },
  food: { title: 'Food', body: 'Buy food here, then eat it from your buttons to get energy back.' },
  sleep: { title: 'Home', body: 'Sleep after 19:00, or whenever you are exhausted, to wake rested at 06:30 the next day.' },
  clinic: { title: 'Mercy Clinic', body: 'Pay to get health back: quick first aid, or full treatment priced by how hurt you are.' },
  traffic: { title: 'Nobody brakes for you', body: 'Cars, danfos and kekes will not stop. Getting hit costs health; at zero you wake up at the clinic.' },
  night: { title: 'Night falls', body: 'Where the street lights work, it is busy and safe. Where they are dead, agberos gather. Watch where you walk.' },
  agbero: { title: 'Agberos!', body: 'Red ring means they are coming for you. Run straight away (they are nearly as fast as you), or settle them for ₦500 and they leave you alone till morning. Get caught and they push you down or rob you.' },
} as const;

export type TipId = keyof typeof TIPS;

const KEY = '9ja-tips-hidden';

export class Tips {
  private hidden = new Set<string>();
  /** Shown this session already (so a tip doesn't nag every time you pass the spot). */
  private seen = new Set<string>();
  private queue: TipId[] = [];
  private current: TipId | null = null;
  private title: HTMLElement;
  private body: HTMLElement;
  private never: HTMLInputElement;

  constructor(private el: HTMLElement) {
    try {
      for (const id of JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]) this.hidden.add(id);
    } catch {
      // Storage blocked: tips just show once per session.
    }
    this.title = el.querySelector('.tip-title')!;
    this.body = el.querySelector('.tip-body')!;
    this.never = el.querySelector('input')!;
    el.querySelector('button')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismiss();
    });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /** Feature came up: show its card (once per session, never if retired). */
  trigger(id: TipId): void {
    if (this.hidden.has(id) || this.seen.has(id)) return;
    this.seen.add(id);
    this.queue.push(id);
    if (!this.current) this.next();
  }

  get open(): boolean {
    return this.current !== null;
  }

  private next(): void {
    const id = this.queue.shift();
    this.current = id ?? null;
    if (!id) {
      this.el.hidden = true;
      return;
    }
    this.title.textContent = TIPS[id].title;
    this.body.textContent = TIPS[id].body;
    this.never.checked = false;
    this.el.hidden = false;
  }

  private dismiss(): void {
    if (this.current && this.never.checked) {
      this.hidden.add(this.current);
      try {
        localStorage.setItem(KEY, JSON.stringify([...this.hidden]));
      } catch {
        // Ignore: it just shows again next session.
      }
    }
    this.next();
  }
}
