import { CLOTHES, type ClothingId, type ClothingSlot, type WornOutfit } from '@9ja/shared';
import type { Game } from './game';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const naira = (n: number) => `₦${n.toLocaleString('en-GB')}`;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const SLOTS: { slot: ClothingSlot; label: string }[] = [
  { slot: 'top', label: 'Tops' },
  { slot: 'bottom', label: 'Bottoms' },
  { slot: 'shoes', label: 'Shoes' },
  { slot: 'hat', label: 'Hats' },
];

export type ClosetMode = 'shop' | 'wardrobe';

/**
 * The clothes panel. At the market it's a stall: tap to try something on, then buy it. At home
 * it's your wardrobe: tap to change. While it's open the camera closes in on the player (main).
 */
export class Closet {
  private mode: ClosetMode | null = null;
  private slot: ClothingSlot = 'top';
  /** Shop: the item being tried on (not bought yet). */
  private trying: ClothingId | null = null;

  constructor(
    private game: Game,
    private toast: (text: string) => void,
  ) {
    $('closet-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (this.mode && e.code === 'Escape') this.close();
    });
    $('closet-buy').addEventListener('click', () => this.buy());
    game.onChange(() => this.mode && this.render());
  }

  get isOpen(): boolean {
    return this.mode !== null;
  }

  get openMode(): ClosetMode | null {
    return this.mode;
  }

  /** What the player should be seen wearing right now: their outfit, plus anything being tried on. */
  get preview(): WornOutfit | null {
    if (!this.trying) return null;
    return { ...this.game.state.outfit, [CLOTHES[this.trying].slot]: this.trying };
  }

  open(mode: ClosetMode): void {
    this.mode = mode;
    this.slot = 'top';
    this.trying = null;
    $('closet').hidden = false;
    $('closet-title').textContent = mode === 'shop' ? 'Clothes stall' : 'Wardrobe';
    this.render();
  }

  close(): void {
    this.mode = null;
    this.trying = null;
    $('closet').hidden = true;
  }

  private buy(): void {
    if (!this.trying) return;
    const r = this.game.dispatch({ type: 'buy_clothes', item: this.trying });
    if (!r.ok) {
      this.toast(r.reason);
      return;
    }
    this.toast(r.message);
    this.trying = null;
    this.render();
  }

  private pick(id: ClothingId | null): void {
    if (this.mode === 'shop') {
      // Tap again to take it off.
      this.trying = this.trying === id ? null : id;
      this.render();
      return;
    }
    const r = this.game.dispatch({ type: 'wear', slot: this.slot, item: id });
    if (!r.ok) this.toast(r.reason);
  }

  private render(): void {
    const s = this.game.state;
    $('closet-money').textContent = naira(s.money);

    const tabs = $('closet-tabs');
    tabs.replaceChildren(
      ...SLOTS.map(({ slot, label }) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = slot === this.slot ? 'on' : '';
        b.addEventListener('click', () => {
          this.slot = slot;
          this.render();
        });
        return b;
      }),
    );

    const ids = (Object.keys(CLOTHES) as ClothingId[])
      .filter((id) => CLOTHES[id].slot === this.slot)
      .filter((id) => this.mode === 'shop' || s.wardrobe.includes(id))
      .sort((a, b) => CLOTHES[a].price - CLOTHES[b].price);
    const worn = s.outfit[this.slot];
    const cards: HTMLElement[] = ids.map((id) => {
      const c = CLOTHES[id];
      const owned = s.wardrobe.includes(id);
      const sub = this.mode === 'shop' ? (owned ? 'Owned' : naira(c.price)) : worn === id ? 'Wearing' : 'Tap to wear';
      const on = this.mode === 'shop' ? this.trying === id : worn === id;
      return this.card(c.name, sub, c.color, 'accent' in c ? c.accent : undefined, on, () => this.pick(id));
    });
    // Hats are optional: at home you can go bare-headed.
    if (this.mode === 'wardrobe' && this.slot === 'hat') cards.unshift(this.card('No hat', worn === null ? 'Wearing' : 'Tap to wear', null, undefined, worn === null, () => this.pick(null)));
    if (!cards.length) {
      const empty = document.createElement('p');
      empty.className = 'closet-empty';
      empty.textContent = 'Nothing here yet. The market sells plenty.';
      cards.push(empty);
    }
    $('closet-items').replaceChildren(...cards);

    // Footer: the buy button in the shop, a hint at home.
    const buy = $('closet-buy') as HTMLButtonElement;
    const note = $('closet-note');
    if (this.mode === 'wardrobe') {
      buy.hidden = true;
      note.textContent = 'Changes are saved as you pick.';
      return;
    }
    buy.hidden = !this.trying;
    if (!this.trying) {
      note.textContent = 'Tap something to try it on.';
      return;
    }
    const c = CLOTHES[this.trying];
    const owned = s.wardrobe.includes(this.trying);
    buy.textContent = `Buy ${naira(c.price)}`;
    buy.disabled = owned || s.money < c.price;
    note.textContent = owned ? 'You own this. Change at home.' : s.money < c.price ? `You need ${naira(c.price - s.money)} more.` : c.name;
  }

  private card(name: string, sub: string, color: number | null, accent: number | undefined, on: boolean, onClick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.className = `closet-item${on ? ' on' : ''}`;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    if (color === null) sw.classList.add('none');
    else {
      sw.style.background = hex(color);
      if (accent !== undefined) sw.style.boxShadow = `inset 0 -7px 0 ${hex(accent)}`;
    }
    const text = document.createElement('span');
    text.className = 'label';
    const n = document.createElement('strong');
    n.textContent = name;
    const small = document.createElement('small');
    small.textContent = sub;
    text.append(n, small);
    b.append(sw, text);
    b.addEventListener('click', onClick);
    return b;
  }
}
