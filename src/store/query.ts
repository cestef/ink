import { Code, Diag } from '../core/diag/index.ts';
import type { Db } from './db.ts';
import type { Driver } from './driver.ts';
import { Name } from './name.ts';
import type { Table } from './table.ts';

/**
 * Equality filters, ordering and a cap. Deliberately not a general SQL builder:
 * every query this product needs is a lookup by key or a list by owner, and a
 * builder that can express more is a builder that can express an injection.
 */
export class Query<S extends Table.Shape> {
  private readonly matches: Query.Match[] = [];
  private ordering: string | null = null;
  private cap: number | null = null;

  constructor(
    private readonly db: Db,
    private readonly table: Table<S>,
  ) {}

  where(match: Table.Match<S>): this {
    for (const [field, value] of Object.entries(match)) {
      this.matches.push({ column: Name.snake(field), op: '=', value: value as Driver.Param });
    }
    return this;
  }

  /** The one comparison beyond equality, because retention needs a cutoff. */
  after(field: keyof S & string, value: number): this {
    this.matches.push({ column: Name.snake(field), op: '>', value });
    return this;
  }

  order(field: keyof S & string, direction: Query.Dir = 'asc'): this {
    this.ordering = `${Name.snake(field)} ${direction === 'desc' ? 'DESC' : 'ASC'}`;
    return this;
  }

  limit(rows: number): this {
    this.cap = rows;
    return this;
  }

  async all(): Promise<Table.Row<S>[]> {
    return this.db.driver.all<Table.Row<S>>(this.sql(), this.params());
  }

  async one(): Promise<Table.Row<S> | null> {
    return this.db.driver.get<Table.Row<S>>(this.limit(1).sql(), this.params());
  }

  /** Count and sum in one round trip, for quota checks on the write path. */
  async tally(field: keyof S & string): Promise<Query.Tally> {
    const column = Name.snake(field);
    const row = await this.db.driver.get<Query.Tally>(
      `SELECT count(*) AS rows, coalesce(sum(${column}), 0) AS total FROM ${this.table.name}${this.filter()}`,
      this.params(),
    );
    return row ?? { rows: 0, total: 0 };
  }

  async exists(): Promise<boolean> {
    const row = await this.db.driver.get<{ n: number }>(
      `SELECT 1 AS n FROM ${this.table.name}${this.filter()} LIMIT 1`,
      this.params(),
    );
    return row !== null;
  }

  /** Unfiltered deletes are a bug, never an intent, so they never reach SQL. */
  async delete(): Promise<void> {
    if (this.matches.length === 0) {
      throw Diag.of(Code.INTERNAL, `refusing to delete every row of ${this.table.name}`).withNote(
        'delete() requires a where() filter',
      );
    }
    await this.db.driver.run(`DELETE FROM ${this.table.name}${this.filter()}`, this.params());
  }

  async update(values: Table.Match<S>): Promise<void> {
    const entries = Object.entries(values);
    const sets = entries.map(([field]) => `${Name.snake(field)} = ?`).join(', ');
    const params = [...entries.map(([, value]) => value as Driver.Param), ...this.params()];
    await this.db.driver.run(`UPDATE ${this.table.name} SET ${sets}${this.filter()}`, params);
  }

  private sql(): string {
    const order = this.ordering ? ` ORDER BY ${this.ordering}` : '';
    const limit = this.cap === null ? '' : ` LIMIT ${this.cap}`;
    return `SELECT ${this.table.selection} FROM ${this.table.name}${this.filter()}${order}${limit}`;
  }

  private filter(): string {
    if (this.matches.length === 0) return '';
    return ` WHERE ${this.matches.map((m) => `${m.column} ${m.op} ?`).join(' AND ')}`;
  }

  private params(): Driver.Param[] {
    return this.matches.map((m) => m.value);
  }
}

export namespace Query {
  export type Dir = 'asc' | 'desc';

  export interface Tally {
    readonly rows: number;
    readonly total: number;
  }

  export type Op = '=' | '>';

  export interface Match {
    readonly column: string;
    readonly op: Query.Op;
    readonly value: Driver.Param;
  }
}
