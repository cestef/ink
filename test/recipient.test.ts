import { describe, expect, test } from 'bun:test';
import { bech32 } from '@scure/base';
import * as age from 'age-encryption';
import { Key } from '../src/core/key.ts';
import { Recipient } from '../src/core/recipient.ts';

/**
 * Acceptance is generated, not tabulated: a hybrid recipient is 1959 characters
 * and pinning one as a literal would test a paste, not the format.
 */
describe('recipient kinds', () => {
  for (const option of Key.OPTIONS) {
    test(`${option.kind} keys generate a recipient ink accepts`, async () => {
      const identity =
        option.kind === 'hybrid' ? await age.generateHybridIdentity() : await age.generateX25519Identity();
      const value = await age.identityToRecipient(identity);

      const recipient = Recipient.parse(value);
      expect(recipient.kind).toBe(option.kind);
      expect(recipient.value).toBe(value);
      expect(recipient.quantum).toBe(option.kind === 'hybrid');
    });
  }

  test('every declared shape decodes to the byte count it claims', () => {
    for (const shape of Recipient.SHAPES) {
      const encoded = bech32.encode(shape.hrp, bech32.toWords(new Uint8Array(shape.bytes)), false);
      expect(encoded.startsWith(shape.prefix)).toBe(true);

      const recipient = Recipient.parse(encoded);
      expect(recipient.kind).toBe(shape.kind);
      expect(recipient.quantum).toBe(shape.quantum);
    }
  });

  test('prefixes are unambiguous, so no recipient parses as two kinds', () => {
    const hrps = Recipient.SHAPES.map((shape) => shape.hrp);
    expect(new Set(hrps).size).toBe(hrps.length);
  });

  test('a hybrid recipient stays under the parse ceiling', async () => {
    const identity = await age.generateHybridIdentity();
    const value = await age.identityToRecipient(identity);
    expect(value.length).toBeLessThan(Recipient.MAX);
    expect(value.length).toBeGreaterThan(1000);
  });

  test('Key.of falls back to the default rather than throwing on junk', () => {
    expect(Key.of('hybrid')).toBe('hybrid');
    expect(Key.of('x25519')).toBe('x25519');
    expect(Key.of('nonsense')).toBe(Key.DEFAULT);
    expect(Key.of(undefined)).toBe(Key.DEFAULT);
  });
});
