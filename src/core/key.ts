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
      note: 'The age default, and a link short enough to paste anywhere.',
    },
    {
      kind: 'hybrid',
      label: 'Post-quantum hybrid (ML-KEM-768 + X25519)',
      note: 'Resists a future quantum attacker. Much longer link, and age 1.3 or newer to decrypt.',
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
