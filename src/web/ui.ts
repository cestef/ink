import { Fault } from './fault.ts';

/**
 * The DOM surface the three pages share. Output is built as nodes, so nothing on
 * the crypto surface ever concatenates markup around a value. Transport lives in
 * `Client`, which is the only thing that knows a URL.
 */
export class Ui {
  /** How long a button says "Copied" before going back to itself. */
  static readonly FLASH = 1600;

  static el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) {
      throw Fault.of('dom.missing', 'page is incomplete', `this page has no #${id}`);
    }
    return node as T;
  }

  static value(id: string): string {
    return Ui.el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id).value;
  }

  /** Empties a control, whatever kind it is, without caring if it is absent. */
  static wipe(id: string): void {
    const node = document.getElementById(id) as HTMLInputElement | null;
    if (node) node.value = '';
  }

  static data(id: string, key: string): string {
    return Ui.el(id).dataset[key] ?? '';
  }

  static make<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> = {},
    children: Ui.Child[] = [],
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    // Widened to ParentNode: the tag-name union has no single `append` signature.
    const parent: ParentNode = node;
    parent.append(...children);
    return Object.assign(node, props);
  }

  static option(value: string, label: string): HTMLOptionElement {
    return Ui.make('option', { value, textContent: label });
  }

  static show(id: string, ...children: Ui.Child[]): void {
    Ui.el(id).replaceChildren(...children);
  }

  static note(text: string): HTMLElement {
    return Ui.make('p', { textContent: text });
  }

  static warn(text: string): HTMLElement {
    return Ui.make('p', { className: 'warn', textContent: text });
  }

  /**
   * The state of something, as aligned pairs. This is what a sentence of prose
   * was doing badly: a reader wants the number, and wants to find it in the
   * same place every time.
   */
  static facts(pairs: readonly Ui.Fact[]): HTMLElement {
    const list = Ui.make('dl', { className: 'facts' });

    for (const [key, value] of pairs) {
      if (value === null) continue;
      list.append(Ui.make('dt', { textContent: key }), Ui.make('dd', { textContent: value }));
    }

    return list;
  }

  /**
   * A value worth keeping: shown in full, with one click to take it away. The
   * button sits on the name's line rather than under the value, so a stack of
   * these does not become a column of one-button rows.
   */
  static field(label: string, value: string): HTMLElement {
    return Ui.make('div', { className: 'field' }, [
      Ui.head(label, Ui.copy(value)),
      Ui.make('pre', { textContent: value }),
    ]);
  }

  /** The same, for something that is bytes rather than text to read. */
  static file(name: string, bytes: Uint8Array): HTMLElement {
    return Ui.make('div', { className: 'field' }, [Ui.head(name, Ui.save(name, bytes))]);
  }

  private static head(label: string, action: HTMLElement): HTMLElement {
    return Ui.make('div', { className: 'head' }, [
      Ui.make('div', { className: 'label', textContent: label }),
      action,
    ]);
  }

  static copy(value: string, label = 'Copy'): HTMLButtonElement {
    const button = Ui.make('button', { type: 'button', textContent: label });

    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = 'Copied';
      } catch {
        // Clipboard access can be refused. Selecting it is the fallback.
        button.textContent = 'Select it above';
      }
      setTimeout(() => {
        button.textContent = label;
      }, Ui.FLASH);
    });

    return button;
  }

  /**
   * Masks a field without trapping its contents: a generated passphrase you
   * cannot read is a passphrase you cannot save.
   */
  static reveal(inputId: string, buttonId: string): void {
    const input = Ui.el<HTMLInputElement>(inputId);
    const button = Ui.el<HTMLButtonElement>(buttonId);

    button.addEventListener('click', () => {
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      button.textContent = hidden ? 'Hide' : 'Show';
    });
  }

  /** Replaces a node's children, for output that is a list of elements. */
  static fill(node: HTMLElement, children: readonly Ui.Child[]): void {
    node.replaceChildren(...children);
  }

  /** A file the owner can take away, without it ever touching the network. */
  static save(name: string, bytes: Uint8Array, label = 'Save'): HTMLAnchorElement {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    return Ui.make('a', { className: 'button', href: url, download: name, textContent: label });
  }

  static download(name: string, contents: string): HTMLAnchorElement {
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain' }));
    return Ui.make('a', { className: 'button', href: url, download: name, textContent: `Save ${name}` });
  }

  /** Wires a button so a thrown error lands in `#out` instead of the console. */
  static guard(id: string, run: () => Promise<void>): void {
    const button = Ui.el<HTMLButtonElement>(id);
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        await run();
      } catch (cause) {
        Ui.show('out', Ui.fault(cause));
      } finally {
        button.disabled = false;
      }
    });
  }

  /** A failure as one block: what happened, then why, then what to do. */
  static fault(cause: unknown): HTMLElement {
    const detail = Fault.describe(cause);
    return Ui.make('div', { className: 'diag' }, [
      Ui.make('strong', { textContent: detail.title }),
      Ui.make('p', { textContent: detail.message }),
      ...detail.lines.map((line) => Ui.make('p', { className: 'hint', textContent: line })),
    ]);
  }

  static reason(cause: unknown): string {
    return Fault.describe(cause).message;
  }
}

export namespace Ui {
  export type Child = Node | string;
  /** A null value drops the row, so a caller can list what may not apply. */
  export type Fact = readonly [string, string | null];
}
