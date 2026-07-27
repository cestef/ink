export class Column<T> {
  private constructor(
    readonly kind: Column.Kind,
    readonly optional: boolean,
  ) {}

  static text(): Column<string> {
    return new Column<string>('TEXT', false);
  }

  static int(): Column<number> {
    return new Column<number>('INTEGER', false);
  }

  orNull(): Column<T | null> {
    return new Column<T | null>(this.kind, true);
  }
}

export namespace Column {
  export type Kind = 'TEXT' | 'INTEGER';
  export type Of<C> = C extends Column<infer T> ? T : never;
}
