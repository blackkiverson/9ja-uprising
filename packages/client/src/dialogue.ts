import { NPCS, checkChoice, greetingNode, relationshipWith, type NpcId } from '@9ja/shared';
import type { Game } from './game';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Conversation panel: speaker, line, and choices. Locked choices stay visible with the reason. */
export class Dialogue {
  private npc: NpcId | null = null;
  private node = '';

  constructor(
    private game: Game,
    private toast: (text: string) => void,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return this.npc !== null;
  }

  open(npc: NpcId): void {
    this.npc = npc;
    this.node = greetingNode(this.game.state, npc);
    $('dialogue').hidden = false;
    this.render();
  }

  close(): void {
    this.npc = null;
    $('dialogue').hidden = true;
  }

  private render(): void {
    if (!this.npc) return;
    const npc = NPCS[this.npc];
    const node = npc.nodes[this.node]!;
    const rel = relationshipWith(this.game.state, this.npc);
    $('dlg-name').textContent = npc.name;
    $('dlg-role').textContent = npc.role;
    $('dlg-rel').textContent = `${rel > 0 ? '+' : ''}${rel}`;
    $('dlg-rel').title = 'How much they like you';
    $('dlg-text').textContent = node.text;

    const list = $('dlg-choices');
    list.replaceChildren();
    const now = this.game.now();
    node.choices.forEach((choice, i) => {
      const check = checkChoice(this.game.state, this.npc!, this.node, i, now);
      if (!check.ok && check.hidden) return;
      const btn = document.createElement('button');
      btn.textContent = choice.text;
      if (!check.ok) {
        btn.disabled = true;
        const why = document.createElement('small');
        why.textContent = check.reason;
        btn.append(why);
      }
      btn.addEventListener('click', () => this.choose(i, choice.next));
      list.append(btn);
    });
    if (!list.children.length) {
      const bye = document.createElement('button');
      bye.textContent = 'Bye';
      bye.addEventListener('click', () => this.close());
      list.append(bye);
    }
  }

  private choose(index: number, next: string | undefined): void {
    if (!this.npc) return;
    const r = this.game.dispatch({ type: 'dialogue', npc: this.npc, node: this.node, choice: index });
    if (!r.ok) {
      this.toast(r.reason);
      return;
    }
    if (r.message) this.toast(r.message);
    if (next) {
      this.node = next;
      this.render();
    } else this.close();
  }
}
