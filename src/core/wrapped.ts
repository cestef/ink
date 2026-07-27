import { Code, Diag, Span } from './diag/index.ts';

/**
 * The master identity, encrypted to a passphrase with age's scrypt recipient and
 * ASCII armored. The server holds this and can do nothing with it. `age -d`
 * opens it with no part of this codebase present, which is the durability claim
 * the product rests on.
 */
export class Wrapped {
  static readonly BEGIN = '-----BEGIN AGE ENCRYPTED FILE-----';
  static readonly END = '-----END AGE ENCRYPTED FILE-----';
  static readonly MAX = 8 * 1024;

  private constructor(readonly value: string) {}

  static parse(input: unknown): Wrapped {
    if (typeof input !== 'string') {
      throw Diag.of(Code.IDENTITY_INVALID, 'wrapped identity must be text').withNote(
        `received ${typeof input}`,
      );
    }
    if (input.length > Wrapped.MAX) {
      throw Diag.of(Code.IDENTITY_INVALID, 'wrapped identity is too large')
        .withHelp(`the cap is ${Wrapped.MAX} bytes`)
        .withNote(`received ${input.length}`);
    }

    const text = input.trim();
    if (!text.startsWith(Wrapped.BEGIN)) throw Wrapped.missing(text, 'header', Wrapped.BEGIN);
    if (!text.endsWith(Wrapped.END)) throw Wrapped.missing(text, 'footer', Wrapped.END);
    return new Wrapped(`${text}\n`);
  }

  private static missing(text: string, part: string, marker: string): Diag {
    const span =
      part === 'header'
        ? new Span(0, Math.min(marker.length, Math.max(text.length, 1)), `expected ${marker}`)
        : Span.from(text, text.lastIndexOf('\n') + 1, `expected ${marker}`);

    return Diag.of(Code.IDENTITY_INVALID, `wrapped identity is missing its ${part}`)
      .withSource(text, span)
      .withHelp('this must be an ASCII armored age file, as produced by armoring a passphrase encryption');
  }

  toString(): string {
    return this.value;
  }
}
