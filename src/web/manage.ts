import * as age from 'age-encryption';
import type { Unlock } from '../core/unlock.ts';
import { Client } from './client.ts';
import { Keyring } from './keyring.ts';
import { Parcel } from './parcel.ts';
import { Ui } from './ui.ts';

/**
 * Reads what people sent. The identity is unwrapped once, in this tab, and
 * lives in this instance for the life of the page.
 */
class Vault {
  private constructor(
    private readonly client: Client,
    private readonly identity: string,
  ) {}

  static async open(client: Client, wrapping: Keyring.Stored, passphrase: string): Promise<Vault> {
    return new Vault(client, await Keyring.open(wrapping, passphrase));
  }

  async render(): Promise<void> {
    const page = await this.client.submissions();
    const capped = page.more ? [Ui.warn(`Showing the newest ${page.limit}. There are more.`)] : [];

    Ui.show(
      'out',
      Ui.note(page.submissions.length === 0 ? 'Nothing sent yet.' : `${page.submissions.length} sealed`),
      Ui.make('p', { className: 'hint', textContent: Vault.policy(page.policy) }),
      ...capped,
      Ui.make('div', { className: 'actions' }, [this.enrol(), this.shut(page.policy.closed)]),
      this.settings(),
    );
    Ui.show('list', ...page.submissions.map((view) => this.item(view)));
  }

  private static policy(policy: Client.Policy): string {
    const kept =
      policy.retain === null
        ? 'Kept until you delete them'
        : `Deleted after ${Math.round(policy.retain / 3_600_000)}h`;
    const burnt = policy.burn ? `${kept}, and destroyed as soon as you open them` : kept;
    return policy.closed ? `Closed to new submissions. ${burnt}` : burnt;
  }

  /**
   * Closing is the reversible one, so it sits in the open. Rotating and
   * deleting are not, so they sit behind a fold.
   */
  private shut(closed: boolean): HTMLElement {
    const button = Ui.make('button', {
      type: 'button',
      textContent: closed ? 'Reopen inbox' : 'Stop accepting',
    });

    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const now = await this.client.close(!closed);
        button.replaceWith(this.shut(now));
      } catch (cause) {
        button.replaceWith(Ui.fault(cause));
      }
    });

    return button;
  }

  /** The two irreversible things, kept behind a fold and confirmed once. */
  private settings(): HTMLElement {
    const rotate = Ui.make('button', { type: 'button', textContent: 'New manage link' });
    rotate.addEventListener('click', async () => {
      rotate.disabled = true;
      try {
        const token = await this.client.rotate();
        location.hash = token;
        rotate.replaceWith(Ui.field('New manage link. The old one no longer works.', location.href));
      } catch (cause) {
        rotate.replaceWith(Ui.fault(cause));
      }
    });

    const remove = Ui.make('button', { type: 'button', textContent: 'Delete inbox' });
    remove.addEventListener('click', async () => {
      if (!confirm('Delete this inbox and everything in it? This cannot be undone.')) return;
      remove.disabled = true;
      try {
        const deleted = await this.client.destroy();
        Ui.show('list');
        Ui.show('out', Ui.note(`Inbox deleted, along with ${deleted} submission(s).`));
      } catch (cause) {
        Ui.show('out', Ui.fault(cause));
      }
    });

    return Ui.make('details', {}, [
      Ui.make('summary', { textContent: 'Inbox settings' }),
      Ui.make('div', { className: 'actions' }, [rotate, remove]),
    ]);
  }

  /** Adding a device is the reason the key is wrapped rather than derived. */
  private enrol(): HTMLElement {
    const button = Ui.make('button', { type: 'button', textContent: 'Add a passkey (asks twice)' });

    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const made = await Keyring.byPasskey(this.identity, 'passkey');
        await this.client.enrol({
          kind: made.kind,
          label: made.label,
          wrapped: made.wrapped,
          ...(made.credential ? { credential: made.credential } : {}),
        });
        button.replaceWith(Ui.note('Passkey added. This inbox opens with it now.'));
      } catch (cause) {
        button.replaceWith(Ui.fault(cause));
      }
    });

    return button;
  }

  private item(view: Client.View): HTMLElement {
    const body = Ui.make('div', {}, [Ui.make('pre', { textContent: '—' })]);
    const open = Ui.make('button', { type: 'button', textContent: 'Decrypt' });
    const drop = Ui.make('button', { type: 'button', textContent: 'Delete' });

    open.addEventListener('click', async () => {
      open.disabled = true;
      try {
        Ui.fill(body, await this.read(view));
        open.remove();
      } catch (cause) {
        Ui.fill(body, [Ui.fault(cause)]);
        open.disabled = false;
      }
    });

    const row = Ui.make('li', {}, [
      Ui.make('div', { className: 'meta', textContent: Vault.when(view) }),
      body,
      Ui.make('div', { className: 'actions' }, [open, drop]),
    ]);

    drop.addEventListener('click', async () => {
      drop.disabled = true;
      try {
        await this.client.discard(view.id);
        row.remove();
      } catch (cause) {
        Ui.fill(body, [Ui.fault(cause)]);
        drop.disabled = false;
      }
    });

    return row;
  }

  private static when(view: Client.View): string {
    const sent = `${new Date(view.createdAt).toLocaleString()} · ${view.size} bytes`;
    return view.readAt === null ? sent : `${sent} · read ${new Date(view.readAt).toLocaleString()}`;
  }

  /**
   * Decrypts, then unpacks. Text lands on the page; a file becomes a download,
   * because a browser is a bad place to look at a PDF byte by byte.
   */
  private async read(view: Client.View): Promise<HTMLElement[]> {
    const decrypter = new age.Decrypter();
    decrypter.addIdentity(this.identity);
    const plain = await decrypter.decrypt(await this.client.ciphertext(view.id), 'uint8array');

    return Parcel.unpack(plain).map((item) =>
      item.text === null
        ? Ui.make('div', { className: 'field' }, [
            Ui.make('div', { className: 'label', textContent: item.name }),
            Ui.make('div', { className: 'actions' }, [Ui.save(item.name, item.bytes)]),
          ])
        : Ui.field(item.name, item.text),
    );
  }
}

/**
 * Asks the inbox how it opens before offering a way in, so nobody is shown a
 * passphrase box for an inbox that only takes a passkey.
 */
class Gate {
  private constructor(
    private readonly client: Client,
    private readonly wrappings: readonly Keyring.Stored[],
  ) {}

  static async boot(): Promise<void> {
    try {
      const client = Client.owner(Ui.data('root', 'slug'), location.hash.slice(1));
      new Gate(client, await client.wrappings()).offer();
    } catch (cause) {
      Ui.show('unlock', Ui.fault(cause));
    }
  }

  private has(kind: Unlock.Kind): Keyring.Stored | undefined {
    return this.wrappings.find((wrapping) => wrapping.kind === kind);
  }

  private offer(): void {
    const passkey = this.has('passkey');
    const passphrase = this.has('passphrase');

    if (passkey && passphrase) {
      this.either(passkey, passphrase);
    } else if (passkey) {
      this.byPasskey(passkey);
    } else if (passphrase) {
      this.byPassphrase(passphrase);
    } else {
      Ui.show('unlock', Ui.warn('This inbox has no unlock method on record.'));
    }
  }

  private byPasskey(wrapping: Keyring.Stored): void {
    Ui.show(
      'unlock',
      Ui.make('div', { className: 'actions' }, [this.button('Unlock with passkey', wrapping)]),
    );
  }

  private byPassphrase(wrapping: Keyring.Stored): void {
    const field = Ui.make('input', { id: 'passphrase', type: 'password', autocomplete: 'current-password' });
    const button = this.button('Unlock', wrapping, () => field.value);

    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') button.click();
    });

    Ui.show(
      'unlock',
      Ui.make('label', { htmlFor: 'passphrase', textContent: 'Passphrase' }),
      field,
      Ui.make('div', { className: 'actions' }, [button]),
    );
    field.focus();
  }

  private either(passkey: Keyring.Stored, passphrase: Keyring.Stored): void {
    this.byPasskey(passkey);
    const other = Ui.make('button', { type: 'button', textContent: 'Use passphrase' });
    other.addEventListener('click', () => this.byPassphrase(passphrase));
    Ui.el('unlock').querySelector('.actions')?.append(other);
  }

  private button(label: string, wrapping: Keyring.Stored, secret?: () => string): HTMLButtonElement {
    const button = Ui.make('button', { type: 'button', textContent: label });

    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const vault = await Vault.open(this.client, wrapping, secret?.() ?? '');
        Ui.show('unlock');
        await vault.render();
      } catch (cause) {
        Ui.show('out', Ui.fault(cause));
        button.disabled = false;
      }
    });

    return button;
  }
}

await Gate.boot();
