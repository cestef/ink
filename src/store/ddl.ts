import { Name } from './name.ts';

/**
 * Schema statements, declared rather than concatenated. A migration passes its
 * own frozen column list here, never a live `Table`: a migration is a record of
 * what was already applied, so deriving it from today's definition would let
 * yesterday's migration change when the schema does.
 */
export class Ddl {
  static readonly ID = 'lower(hex(randomblob(16)))';

  static table(name: string, columns: Record<string, string>, options: Ddl.Options = {}): string {
    const body = Object.entries(columns)
      .map(([field, spec]) => `${Name.snake(field)} ${spec}`)
      .join(', ');
    return `CREATE TABLE ${options.ifNotExists ? 'IF NOT EXISTS ' : ''}${name} (${body})`;
  }

  /** Introspection has no builder form, so the one PRAGMA lives here. */
  static columns(table: string): string {
    return `PRAGMA table_info(${table})`;
  }

  static index(name: string, table: string, columns: readonly Ddl.Order[]): string {
    const body = columns.map((column) => Ddl.order(column)).join(', ');
    return `CREATE INDEX ${name} ON ${table} (${body})`;
  }

  static dropColumn(table: string, field: string): string {
    return `ALTER TABLE ${table} DROP COLUMN ${Name.snake(field)}`;
  }

  static addColumn(table: string, field: string, spec: string): string {
    return `ALTER TABLE ${table} ADD COLUMN ${Name.snake(field)} ${spec}`;
  }

  /**
   * Moves rows between tables during a migration. Values are either a source
   * field, or a literal wrapped in `Ddl.value`, so nothing is interpolated by
   * accident.
   */
  static backfill(options: Ddl.Backfill): string {
    const entries = Object.entries(options.values);
    const columns = entries.map(([field]) => Name.snake(field)).join(', ');
    const selected = entries.map(([, source]) => Ddl.source(source)).join(', ');
    return `INSERT INTO ${options.into} (${columns}) SELECT ${selected} FROM ${options.from}`;
  }

  static value(literal: string | number | null): Ddl.Value {
    if (literal === null) return { literal: 'NULL' };
    if (typeof literal === 'number') return { literal: String(literal) };
    return { literal: `'${literal.replaceAll("'", "''")}'` };
  }

  static raw(expression: string): Ddl.Value {
    return { literal: expression };
  }

  private static source(source: Ddl.Source): string {
    return typeof source === 'string' ? Name.snake(source) : source.literal;
  }

  private static order(column: Ddl.Order): string {
    return typeof column === 'string'
      ? Name.snake(column)
      : `${Name.snake(column.field)} ${column.desc ? 'DESC' : 'ASC'}`;
  }
}

export namespace Ddl {
  export interface Options {
    readonly ifNotExists?: boolean;
  }

  export interface Value {
    readonly literal: string;
  }

  /** A source field name, or a literal value to write into every row. */
  export type Source = string | Ddl.Value;

  export type Order = string | { readonly field: string; readonly desc?: boolean };

  export interface Backfill {
    readonly into: string;
    readonly from: string;
    readonly values: Record<string, Ddl.Source>;
  }
}
