import { Code, Diag } from './diag/index.ts';

/**
 * How a master identity can be unwrapped. The identity itself is generated once
 * and never changes; each unlock method is a separate wrapping of it.
 *
 * That envelope is not decoration. A passkey is a credential people delete
 * without ceremony, and deriving the key from it directly would mean the key
 * dies with it. Wrapping keeps the blast radius of losing one method to that
 * method alone, and is what lets a second device be enrolled later.
 */
export class Unlock {
  static readonly LABEL_MAX = 60;

  /** The element id of the unlock-method control, so nothing else claims it. */
  static readonly CONTROL = 'method';

  static readonly OPTIONS: readonly Unlock.Option[] = [
    {
      kind: 'passkey',
      label: 'Passkey',
      note: 'Held by your device or password manager. Asks twice: once to create it, once to use it.',
    },
    {
      kind: 'passphrase',
      label: 'Passphrase',
      note: 'Works anywhere. As strong as the one you pick, and nothing recovers it.',
    },
  ];

  static readonly PASSKEY: Unlock.Option = Unlock.OPTIONS[0]!;

  static of(value: unknown): Unlock.Kind | null {
    return Unlock.OPTIONS.find((option) => option.kind === value)?.kind ?? null;
  }

  static parse(input: unknown): Unlock.Kind {
    const kind = Unlock.of(input);
    if (kind) return kind;

    throw Diag.of(Code.WRAPPING_INVALID, 'unknown unlock kind')
      .withHelp(`accepted: ${Unlock.OPTIONS.map((option) => option.kind).join(', ')}`)
      .withNote(`received ${JSON.stringify(input)}`);
  }

  static label(input: unknown, fallback: Unlock.Kind): string {
    if (input === undefined || input === null) return fallback;
    if (typeof input !== 'string' || input.trim().length === 0) {
      throw Diag.of(Code.WRAPPING_INVALID, 'label must be text');
    }
    const text = input.trim();
    if (text.length > Unlock.LABEL_MAX) {
      throw Diag.of(Code.WRAPPING_INVALID, `a label is at most ${Unlock.LABEL_MAX} characters`).withNote(
        `received ${text.length}`,
      );
    }
    return text;
  }
}

export namespace Unlock {
  export type Kind = 'passkey' | 'passphrase';

  export interface Option {
    readonly kind: Unlock.Kind;
    readonly label: string;
    readonly note: string;
  }
}
