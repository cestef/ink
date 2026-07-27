import type { Column } from './column.ts';
import type { Db } from './db.ts';
import type { Driver } from './driver.ts';
import { Name } from './name.ts';
import { Query } from './query.ts';

/**
 * A table declared in TypeScript. Column names are derived from field names, so
 * snake_case exists only inside the SQL this file generates and never appears in
 * a caller. Migrations stay literal on purpose: they are a frozen record of what
 * was already applied, and generating them from the live definition would let
 * yesterday's migration change when today's schema does.
 */
export class Table<S extends Table.Shape> {
  constructor(
    readonly name: string,
    readonly columns: S,
  ) {}

  get fields(): (keyof S & string)[] {
    return Object.keys(this.columns) as (keyof S & string)[];
  }

  /** `id, slug, wrapped_identity AS wrappedIdentity` */
  get selection(): string {
    return this.fields
      .map((field) => {
        const column = Name.snake(field);
        return column === field ? field : `${column} AS ${field}`;
      })
      .join(', ');
  }

  select(db: Db): Query<S> {
    return new Query(db, this);
  }

  async insert(db: Db, row: Table.Row<S>): Promise<void> {
    const fields = this.fields;
    const columns = fields.map((field) => Name.snake(field)).join(', ');
    const holes = fields.map(() => '?').join(', ');
    const params = fields.map((field) => row[field] as Driver.Param);
    await db.driver.run(`INSERT INTO ${this.name} (${columns}) VALUES (${holes})`, params);
  }
}

export namespace Table {
  export type Shape = Record<string, Column<unknown>>;

  export type Row<S extends Table.Shape> = {
    [K in keyof S]: Column.Of<S[K]>;
  };

  export type Match<S extends Table.Shape> = Partial<Table.Row<S>>;
}
