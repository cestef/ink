import * as age from 'age-encryption';
import { Client } from './client.ts';
import { Fault } from './fault.ts';
import { Parcel } from './parcel.ts';
import { Ui } from './ui.ts';

const slug = Ui.data('root', 'slug');
const pinned = Ui.data('root', 'recipient');
const fragment = location.hash.slice(1);

/**
 * The fragment is the key of record, and a link without one is a link whose key
 * the server chose. That is exactly the substitution ink claims it cannot make,
 * so the fallback is never taken silently: sending stays disabled until someone
 * chooses the downgrade, rather than proceeding past a warning nobody reads.
 */
class Downgrade {
  private static accepted = false;

  static offer(): void {
    const send = Ui.el<HTMLButtonElement>('send');
    send.disabled = true;

    const accept = Ui.make('button', {
      type: 'button',
      textContent: 'I understand, encrypt to the key this server offers',
    });

    accept.addEventListener('click', () => {
      Downgrade.accepted = true;
      send.disabled = false;
      accept.remove();
    });

    // The button belongs inside the block, not after it: it is the answer to
    // the warning, and a sibling would sit outside the rule that frames it.
    Ui.show(
      'warn',
      Ui.make('div', { className: 'warn' }, [
        Ui.make('p', {
          textContent:
            'This link arrived without its key, so the only key available is the one this server offers, which the server could have chosen. Ask the recipient for the full link, the one ending in a # and a key.',
        }),
        accept,
      ]),
    );
  }

  static check(): void {
    if (Downgrade.accepted) return;
    throw Fault.of(
      'recipient.unpinned',
      'no key in this link',
      'this link is missing the key after its #',
      'ask whoever sent it for the complete link',
    );
  }
}

/**
 * The escape hatch. Everything above runs JavaScript this server delivered, so
 * a sender who does not trust it can encrypt with the stock `age` binary and
 * post the bytes, never loading the crypto path at all. That option exists only
 * because what ink stores is an age file rather than a private blob format.
 */
class Bypass {
  static show(target: string, fromLink: boolean): void {
    const command = [
      `printf %s 'YOUR SECRET' \\`,
      `  | age -e -r ${target} \\`,
      `  | curl -s --data-binary @- \\`,
      `      -H 'content-type: application/octet-stream' \\`,
      `      ${Client.endpoint(slug)}`,
    ].join('\n');

    const body: Ui.Child[] = [
      Ui.make('summary', { textContent: 'Send it from a terminal instead' }),
      Ui.make('p', { className: 'hint', textContent: 'Same result, without running any of our code.' }),
    ];

    /**
     * Whoever opens this block is here because they would rather not trust the
     * page. Handing them a key the server picked, printed as though it came
     * from the link, would be the one substitution the whole product is against
     * and the only place it would go unremarked.
     */
    if (!fromLink) {
      body.push(
        Ui.warn(
          'The key below is not from your link, because your link has none. It is the key this server offers, and the server could have chosen it. Running this command trusts the server exactly as much as running the page does.',
        ),
      );
    }

    body.push(Ui.make('pre', { textContent: command }));

    Ui.show('bypass', Ui.make('details', {}, body));
  }
}

const recipient = fragment || pinned;
if (!fragment) Downgrade.offer();
Bypass.show(recipient, Boolean(fragment));

Ui.guard('send', async () => {
  if (!fragment) Downgrade.check();

  // Everything the form asked for becomes one tar, then one age file.
  const parcel = await Parcel.pack(Parcel.fields());

  const encrypter = new age.Encrypter();
  encrypter.addRecipient(recipient);
  const ciphertext = await encrypter.encrypt(parcel);

  await Client.anonymous(slug).submit(ciphertext);

  /**
   * Show what was actually produced. The claim on this page is that the words
   * left as something unreadable, and this is that claim, in the reader's own
   * submission, rather than a reassuring sentence.
   */
  const sealed = Ui.make('pre', { textContent: age.armor.encode(ciphertext) });
  for (const field of Parcel.fields()) Ui.wipe(`f-${field.key}`);
  if (Parcel.fields().length === 0) Ui.wipe('secret');

  Ui.show(
    'out',
    Ui.note('Sealed and sent. This is what the server received, and it cannot open it.'),
    sealed,
    Ui.make('p', {
      className: 'hint',
      textContent: `Only the holder of ${recipient.slice(0, 16)}… can read it again.`,
    }),
  );
});
