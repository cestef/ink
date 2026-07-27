import * as age from 'age-encryption';
import { Archive } from '../core/archive.ts';
import { Size } from '../core/size.ts';
import type { Unlock } from '../core/unlock.ts';
import { When } from '../core/when.ts';
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
    const capped = page.more ? [Ui.warn(`Showing the newest ${page.limit} of more.`)] : [];

    Ui.show(
      'out',
      Ui.facts(Vault.summary(page)),
      ...capped,
      Ui.make('div', { className: 'actions' }, [
        this.enrol(),
        this.shut(page.policy.closed),
        this.exporter(page.policy.burn),
      ]),
      this.settings(),
    );
    Ui.show('list', ...page.submissions.map((view) => this.item(view, page.policy)));
  }

  private static summary(page: Client.Page): Ui.Fact[] {
    const now = Date.now();
    const sent = page.submissions;
    const unread = sent.filter((view) => view.readAt === null).length;
    const bytes = sent.reduce((total, view) => total + view.size, 0);
    const oldest = sent[sent.length - 1];

    return [
      ['Held', Vault.held(sent.length, unread)],
      ['Size', sent.length === 0 ? null : Size.human(bytes)],
      ['Newest', sent[0] ? When.ago(sent[0].createdAt, now) : null],
      ['Oldest', oldest && sent.length > 1 ? When.ago(oldest.createdAt, now) : null],
      ['Retention', Vault.retention(page.policy)],
      ['Accepting', page.policy.closed ? 'no, closed' : 'yes'],
    ];
  }

  private static held(count: number, unread: number): string {
    if (count === 0) return 'nothing yet';
    if (unread === 0) return `${count}, all read`;
    if (unread === count) return `${count}, none read`;
    return `${count}, ${unread} unread`;
  }

  private static retention(policy: Client.Policy): string {
    if (policy.burn) return 'destroyed on read';
    return policy.retain === null ? 'until deleted' : When.span(policy.retain);
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

  /**
   * Everything the inbox holds, sealed, as one tar. Exported as ciphertext
   * rather than plaintext on purpose: writing every secret to a downloads
   * folder would undo the only thing this does, and the archive still opens
   * with age on any machine.
   */
  private exporter(burns: boolean): HTMLElement {
    const button = Ui.make('button', { type: 'button', textContent: 'Export all' });

    button.addEventListener('click', async () => {
      // Exporting reads, and on a burn inbox reading destroys. Nobody should
      // discover that from an empty list afterwards.
      if (
        burns &&
        !confirm(
          'This inbox destroys submissions when they are read. Exporting will read every one, and they will be gone afterwards. Continue?',
        )
      ) {
        return;
      }

      button.disabled = true;
      const said = button.textContent;
      try {
        const page = await this.client.submissions();
        const items: Archive.Item[] = [];

        for (const [at, view] of page.submissions.entries()) {
          button.textContent = `Exporting ${at + 1} of ${page.submissions.length}`;
          items.push({
            id: view.id,
            createdAt: view.createdAt,
            bytes: await this.client.ciphertext(view.id),
          });
        }

        const slug = Ui.data('root', 'slug');
        const at = new Date();
        button.replaceWith(Ui.save(Archive.name(slug, at), Archive.pack(slug, items, at)));
      } catch (cause) {
        button.replaceWith(Ui.fault(cause));
      } finally {
        button.textContent = said;
        button.disabled = false;
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

  private item(view: Client.View, policy: Client.Policy): HTMLElement {
    // Empty until it is opened. A placeholder box per row is a column of
    // nothing, and the row already says there is something sealed here.
    const body = Ui.make('div', {});
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

    const meta = Ui.make('div', { className: 'meta', textContent: Vault.when(view) });
    // The exact timestamp is one hover away rather than occupying the row.
    meta.title = When.exact(view.createdAt);

    const row = Ui.make('li', {}, [meta, body, Ui.make('div', { className: 'actions' }, [open, drop])]);

    if (policy.burn) open.textContent = 'Decrypt and destroy';

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
    const now = Date.now();
    const read = view.readAt === null ? 'unread' : `read ${When.ago(view.readAt, now)}`;
    return `${When.ago(view.createdAt, now)} · ${Size.human(view.size)} · ${read}`;
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
