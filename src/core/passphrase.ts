/**
 * The passphrase is the only thing protecting the wrapped identity, and the
 * server hands that identity to anyone holding the manage token. Since the
 * token travels in a URL fragment, which survives in history and gets
 * forwarded, a weak passphrase is one leaked link away from every submission.
 *
 * age's scrypt work factor buys time, not entropy. This owns the entropy.
 */
export class Passphrase {
  static readonly MIN = 12;
  static readonly GROUPS = 5;
  static readonly PER_GROUP = 4;

  /** Ambiguous glyphs removed, so a passphrase survives being read aloud. */
  static readonly ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

  /** Roughly 100 bits: 20 characters drawn from a 32 symbol alphabet. */
  static generate(): string {
    const length = Passphrase.GROUPS * Passphrase.PER_GROUP;
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);

    const chars = [...bytes].map((b) => Passphrase.ALPHABET[b % Passphrase.ALPHABET.length]);
    const groups: string[] = [];
    for (let i = 0; i < length; i += Passphrase.PER_GROUP) {
      groups.push(chars.slice(i, i + Passphrase.PER_GROUP).join(''));
    }
    return groups.join('-');
  }

  static weak(value: string): boolean {
    return value.trim().length < Passphrase.MIN;
  }
}
