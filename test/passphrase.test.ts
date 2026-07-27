import { describe, expect, test } from 'bun:test';
import { Passphrase } from '../src/core/passphrase.ts';

describe('passphrase policy', () => {
  test('rejects anything under the floor, including padded whitespace', () => {
    expect(Passphrase.weak('')).toBe(true);
    expect(Passphrase.weak('a')).toBe(true);
    expect(Passphrase.weak('short')).toBe(true);
    expect(Passphrase.weak(' '.repeat(Passphrase.MIN))).toBe(true);
    expect(Passphrase.weak('x'.repeat(Passphrase.MIN))).toBe(false);
  });

  test('a generated passphrase clears its own floor', () => {
    for (let i = 0; i < 50; i++) {
      expect(Passphrase.weak(Passphrase.generate())).toBe(false);
    }
  });

  test('generated passphrases are drawn from the unambiguous alphabet', () => {
    const value = Passphrase.generate();
    expect(value.replaceAll('-', '')).toMatch(new RegExp(`^[${Passphrase.ALPHABET}]+$`));
    for (const glyph of ['l', 'o', '0', '1']) expect(value).not.toContain(glyph);
  });

  test('generated passphrases do not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => Passphrase.generate()));
    expect(seen.size).toBe(200);
  });
});
