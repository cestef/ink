/**
 * The identity kinds ink can generate. Both are native age, both are what
 * `age-keygen` produces (plain and `-pq`), and both decrypt with the stock CLI.
 * Tag recipients are absent on purpose: they address a key ink does not hold.
 */
export class Key {
  static readonly DEFAULT: Key.Kind = 'x25519';

  static readonly OPTIONS: readonly Key.Option[] = [
    {
      kind: 'x25519',
      label: 'X25519',
      note: '62 character link. Opens with any version of age.',
    },
    {
      kind: 'hybrid',
      label: 'Post-quantum hybrid (ML-KEM-768 + X25519)',
      note: '1959 character link. Needs age 1.3 to decrypt, and resists a future quantum attacker.',
    },
  ];

  static of(value: unknown): Key.Kind {
    const match = Key.OPTIONS.find((option) => option.kind === value);
    return match?.kind ?? Key.DEFAULT;
  }
}

export namespace Key {
  export type Kind = 'x25519' | 'hybrid';

  export interface Option {
    readonly kind: Key.Kind;
    readonly label: string;
    readonly note: string;
  }
}
