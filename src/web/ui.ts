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

  /** A value worth keeping: shown in full, with one click to take it away. */
  static field(label: string, value: string): HTMLElement {
    return Ui.make('div', { className: 'field' }, [
      Ui.make('div', { className: 'label', textContent: label }),
      Ui.make('pre', { textContent: value }),
      Ui.make('div', { className: 'actions' }, [Ui.copy(value)]),
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
  static save(name: string, bytes: Uint8Array): HTMLAnchorElement {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    return Ui.make('a', { href: url, download: name, textContent: `Save ${name}` });
  }

  static download(name: string, contents: string): HTMLAnchorElement {
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain' }));
    return Ui.make('a', { href: url, download: name, textContent: `download ${name}` });
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
}
