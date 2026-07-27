import { bech32 } from '@scure/base';
import { Code, Diag, Span } from './diag/index.ts';

/**
 * An age recipient. Every native kind the format defines is accepted, including
 * the post-quantum hybrids: `age` v1.3 generates them with `age-keygen -pq` and
 * opens them unaided, so refusing them would cost interop rather than protect it.
 *
 * The server stores one only so the submit page can warn when a link arrives
 * stripped of its fragment. It is never the source of truth for encryption: the
 * fragment is, so this server cannot swap in a key it holds the identity for.
 */
export class Recipient {
  /** A hybrid recipient is 1959 characters. This leaves room and bounds parsing. */
  static readonly MAX = 4096;

  private constructor(
    readonly value: string,
    readonly shape: Recipient.Shape,
  ) {}

  static parse(input: unknown): Recipient {
    if (typeof input !== 'string') {
      throw Diag.of(Code.RECIPIENT_INVALID, 'recipient must be text').withNote(`received ${typeof input}`);
    }
    if (input.length === 0 || input.length > Recipient.MAX) {
      throw Diag.of(Code.RECIPIENT_INVALID, 'recipient is empty or implausibly long')
        .withHelp(`the longest native recipient is ${Recipient.MAX} characters`)
        .withNote(`received ${input.length}`);
    }

    const decoded = Recipient.decode(input);
    const shape = Recipient.SHAPES.find((candidate) => candidate.hrp === decoded.prefix);
    if (!shape) throw Recipient.unknown(input, decoded.prefix);
    if (decoded.bytes.length !== shape.bytes) throw Recipient.wrong(input, shape, decoded.bytes.length);

    return new Recipient(input, shape);
  }

  /** bech32 carries a checksum, so a mistyped recipient is caught here. */
  private static decode(input: string): { prefix: string; bytes: Uint8Array } {
    try {
      return bech32.decodeToBytes(input);
    } catch (cause) {
      throw Diag.of(Code.RECIPIENT_INVALID, 'recipient is not valid bech32')
        .withSource(input, Span.whole(input, 'checksum or charset failed'))
        .withHelp('copy the whole recipient, as printed by age-keygen')
        .withNote(cause instanceof Error ? cause.message : String(cause));
    }
  }

  private static unknown(input: string, prefix: string): Diag {
    return Diag.of(Code.RECIPIENT_INVALID, `"${prefix}" is not an age recipient prefix`)
      .withSource(input, new Span(0, prefix.length, 'unrecognised prefix'))
      .withHelp(`accepted: ${Recipient.SHAPES.map((shape) => shape.prefix).join(', ')}`)
      .withNote('plugin recipients are not supported, since the identity lives in your browser');
  }

  private static wrong(input: string, shape: Recipient.Shape, bytes: number): Diag {
    return Diag.of(Code.RECIPIENT_INVALID, `a ${shape.kind} recipient carries ${shape.bytes} bytes`)
      .withSource(input, Span.whole(input, 'wrong payload size'))
      .withNote(`decoded ${bytes}`);
  }

  get kind(): Recipient.Kind {
    return this.shape.kind;
  }

  /** Whether the key resists a future quantum attacker, for display only. */
  get quantum(): boolean {
    return this.shape.quantum;
  }

  toString(): string {
    return this.value;
  }
}

export namespace Recipient {
  export type Kind = 'x25519' | 'hybrid' | 'tag' | 'tag-hybrid';

  export interface Shape {
    readonly kind: Recipient.Kind;
    /** What the recipient reads as, including the bech32 separator. */
    readonly prefix: string;
    /** The bech32 human-readable part, which is what actually identifies it. */
    readonly hrp: string;
    readonly bytes: number;
    readonly quantum: boolean;
  }

  export const SHAPES: readonly Recipient.Shape[] = [
    { kind: 'x25519', prefix: 'age1', hrp: 'age', bytes: 32, quantum: false },
    { kind: 'hybrid', prefix: 'age1pq1', hrp: 'age1pq', bytes: 1216, quantum: true },
    { kind: 'tag', prefix: 'age1tag1', hrp: 'age1tag', bytes: 33, quantum: false },
    { kind: 'tag-hybrid', prefix: 'age1tagpq1', hrp: 'age1tagpq', bytes: 1249, quantum: true },
  ];
}
