import * as age from 'age-encryption';
import { Key } from '../core/key.ts';
import { Passphrase } from '../core/passphrase.ts';
import { Unlock } from '../core/unlock.ts';
import { Client } from './client.ts';
import { Fault } from './fault.ts';
import { Form } from './form.ts';
import { Keyring } from './keyring.ts';
import { Ui } from './ui.ts';

/**
 * The master identity is generated here and never leaves in the clear. The
 * server receives the recipient and one wrapping, which is to say: nothing it
 * can open. More unlock methods are added later, from the inbox itself.
 */
class Identity {
  /**
   * Pinned per kind rather than calling `generateIdentity`, whose documented
   * behaviour may switch to hybrid. What ink generates has to be what the user
   * chose, not what the library defaults to this release.
   */
  static generate(kind: Key.Kind): Promise<string> {
    return kind === 'hybrid' ? age.generateHybridIdentity() : age.generateX25519Identity();
  }

  /**
   * Opens the wrapping about to be sent and re-derives the recipient from it.
   * A wrapping that does not round trip is an inbox nobody can ever read, and
   * it would fail at the worst possible moment.
   *
   * Skipped for a passkey, and that is a deliberate trade rather than an
   * oversight. Unwrapping needs another WebAuthn ceremony, so this check would
   * cost a third prompt on top of the two enrolment already requires, forever,
   * on every inbox. What it guards is a bug in the wrapping code, which is the
   * same code for both kinds and is exercised by the passphrase path in tests.
   * A gesture is not a thing to spend on a test the suite already runs.
   */
  static async verify(made: Keyring.Made, recipient: string, passphrase: string): Promise<void> {
    if (made.kind === 'passkey') return;

    const identity = await Keyring.open(
      {
        id: '',
        kind: made.kind,
        label: made.label,
        credential: made.credential ?? null,
        armored: made.wrapped,
        createdAt: 0,
      },
      passphrase,
    );

    if ((await age.identityToRecipient(identity)) === recipient) return;

    throw Fault.of(
      'identity.mismatch',
      'Key check failed',
      'The wrapped key does not match the recipient it came from.',
      'Nothing was created, which is the safe outcome.',
    );
  }
}

/** Shows only the fields the chosen unlock method actually needs. */
class Choice {
  private static readonly control = Ui.el<HTMLSelectElement>(Unlock.CONTROL);

  static wire(): void {
    Choice.control.addEventListener('change', Choice.sync);
    if (!Keyring.supported()) Choice.dropPasskey();
    Choice.sync();
  }

  static get kind(): Unlock.Kind {
    return Unlock.of(Choice.control.value) ?? 'passphrase';
  }

  private static sync(): void {
    Ui.el('passphrase-field').hidden = Choice.kind !== 'passphrase';
    // Enrolling a passkey needs two ceremonies. Say so before it happens.
    Ui.el('method-note').textContent =
      Unlock.OPTIONS.find((option) => option.kind === Choice.kind)?.note ?? '';
  }

  private static dropPasskey(): void {
    const option = Choice.control.querySelector<HTMLOptionElement>('option[value="passkey"]');
    if (option) option.remove();
    Choice.control.value = 'passphrase';
    Ui.show('out', Ui.warn('This browser cannot make a passkey, so this inbox will use a passphrase.'));
  }
}

Choice.wire();

const kinds = Ui.el<HTMLSelectElement>('kind');
const note = Ui.el('kind-note');
const describe = () => {
  note.textContent = Key.OPTIONS.find((option) => option.kind === Key.of(kinds.value))?.note ?? '';
};
kinds.addEventListener('change', describe);
describe();

Ui.el<HTMLButtonElement>('suggest').addEventListener('click', () => {
  Ui.el<HTMLInputElement>('passphrase').value = Passphrase.generate();
});

Form.wire();

Ui.guard('create', async () => {
  const slug = Ui.value('slug').trim();
  const title = Ui.value('title').trim();
  const passphrase = Ui.value('passphrase');

  const identity = await Identity.generate(Key.of(kinds.value));
  const recipient = await age.identityToRecipient(identity);

  const made =
    Choice.kind === 'passkey'
      ? await Keyring.byPasskey(identity, 'passkey')
      : await Keyring.byPassphrase(identity, passphrase);

  await Identity.verify(made, recipient, passphrase);

  const { token } = await Client.create({
    slug,
    title,
    recipient,
    retain: Ui.value('retain'),
    fields: Form.read(),
    burn: Ui.el<HTMLInputElement>('burn').checked,
    wrappings: [
      {
        kind: made.kind,
        label: made.label,
        wrapped: made.wrapped,
        ...(made.credential ? { credential: made.credential } : {}),
      },
    ],
  });

  Ui.show(
    'out',
    Ui.field('Give this out', Client.link(slug, recipient)),
    Ui.field('Keep this to read what arrives', Client.manage(slug, token)),
    // The key file is the one thing here that cannot be reissued, so it is
    // stated as what is lost without it rather than as an instruction.
    Ui.make('div', { className: 'warn' }, [
      Ui.make('p', { textContent: 'Save the key file. Nothing here opens without it.' }),
      Ui.facts([
        ['Opens with', `age -d -i ${slug}.identity.txt`],
        ['Also opened by', made.label],
        ['If both are lost', 'every submission is unreadable, permanently'],
      ]),
      Ui.download(`${slug}.identity.txt`, `${identity}\n`),
    ]),
  );
});
