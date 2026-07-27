import type { Field } from '../core/field.ts';
import { Id } from '../core/id.ts';
import { Column } from './column.ts';
import type { Db } from './db.ts';
import type { Inbox } from './inbox.ts';
import { Table } from './table.ts';

/**
 * What an inbox asks for, in the order it asks. Labels only: a value never
 * reaches the server in any form, so there is nothing stored here a submission
 * could be reconstructed from.
 */
export class Schema {
  private constructor(readonly row: Schema.Row) {}

  static async write(db: Db, inbox: Inbox, fields: readonly Field[]): Promise<void> {
    for (const [at, field] of fields.entries()) {
      await Schema.TABLE.insert(db, {
        id: Id.make(),
        inboxId: inbox.id,
        position: at,
        key: field.key,
        label: field.label,
        kind: field.kind,
        required: field.required ? 1 : 0,
      });
    }
  }

  static async of(db: Db, inbox: Inbox): Promise<Schema[]> {
    const rows = await Schema.TABLE.select(db).where({ inboxId: inbox.id }).order('position', 'asc').all();
    return rows.map((row) => new Schema(row));
  }

  /** Removed with the inbox, since a schema without one asks nobody anything. */
  static async clear(db: Db, inbox: Inbox): Promise<void> {
    await Schema.TABLE.select(db).where({ inboxId: inbox.id }).delete();
  }

  view(): Field.View {
    return {
      key: this.row.key,
      label: this.row.label,
      kind: this.row.kind as Field.Kind,
      required: this.row.required === 1,
    };
  }
}

export namespace Schema {
  export const TABLE = new Table('field', {
    id: Column.text(),
    inboxId: Column.text(),
    position: Column.int(),
    key: Column.text(),
    label: Column.text(),
    kind: Column.text(),
    required: Column.int(),
  });

  export type Row = Table.Row<(typeof TABLE)['columns']>;
}
