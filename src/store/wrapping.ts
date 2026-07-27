import { Code, Diag } from '../core/diag/index.ts';
import { Id } from '../core/id.ts';
import type { Unlock } from '../core/unlock.ts';
import type { Wrapped } from '../core/wrapped.ts';
import { Column } from './column.ts';
import type { Db } from './db.ts';
import type { Inbox } from './inbox.ts';
import { Table } from './table.ts';

/**
 * One wrapping of the master identity, under one unlock method. Every row holds
 * the same identity sealed a different way, so adding a device adds a row and
 * losing one removes a row, and neither touches the key itself.
 *
 * The server can open none of them.
 */
export class Wrapping {
  /** Enough for a few devices and a passphrase, few enough to bound the read. */
  static readonly MAX = 8;

  private constructor(readonly row: Wrapping.Row) {}

  static async add(db: Db, inbox: Inbox, input: Wrapping.New): Promise<Wrapping> {
    const held = await Wrapping.TABLE.select(db).where({ inboxId: inbox.id }).tally('createdAt');
    if (held.rows >= Wrapping.MAX) {
      throw Diag.of(Code.WRAPPING_MANY, `an inbox holds at most ${Wrapping.MAX} unlock methods`)
        .withHelp('remove one you no longer use, then add this again')
        .withNote(`already holding ${held.rows}`);
    }
    return Wrapping.write(db, inbox, input);
  }

  /** Used at creation, where the cap cannot yet have been reached. */
  static async write(db: Db, inbox: Inbox, input: Wrapping.New): Promise<Wrapping> {
    const row: Wrapping.Row = {
      id: Id.make(),
      inboxId: inbox.id,
      kind: input.kind,
      label: input.label,
      armored: input.wrapped.value,
      credential: input.credential ?? null,
      createdAt: Date.now(),
    };
    await Wrapping.TABLE.insert(db, row);
    return new Wrapping(row);
  }

  static async list(db: Db, inbox: Inbox): Promise<Wrapping[]> {
    const rows = await Wrapping.TABLE.select(db)
      .where({ inboxId: inbox.id })
      .order('createdAt', 'asc')
      .limit(Wrapping.MAX)
      .all();
    return rows.map((row) => new Wrapping(row));
  }

  /**
   * Refuses to remove the last one. An inbox with no unlock method is an inbox
   * whose submissions are gone, and that must not be reachable by one click.
   */
  static async remove(db: Db, inbox: Inbox, id: string): Promise<void> {
    const held = await Wrapping.list(db, inbox);
    if (held.length <= 1) {
      throw Diag.of(Code.WRAPPING_NONE, 'this is the only way into this inbox')
        .withHelp('add another unlock method first, then remove this one')
        .withNote('removing it would leave every submission unreadable forever');
    }
    if (!held.some((wrapping) => wrapping.row.id === id)) {
      throw Diag.of(Code.WRAPPING_INVALID, 'no such unlock method on this inbox');
    }
    await Wrapping.TABLE.select(db).where({ id, inboxId: inbox.id }).delete();
  }

  /**
   * Removes every method at once. Only for deleting the inbox itself: the
   * last-one guard exists to stop an accident, not to stop a decision.
   */
  static async clear(db: Db, inbox: Inbox): Promise<void> {
    await Wrapping.TABLE.select(db).where({ inboxId: inbox.id }).delete();
  }

  view(): Wrapping.View {
    return {
      id: this.row.id,
      kind: this.row.kind as Unlock.Kind,
      label: this.row.label,
      credential: this.row.credential,
      armored: this.row.armored,
      createdAt: this.row.createdAt,
    };
  }
}

export namespace Wrapping {
  export const TABLE = new Table('wrapping', {
    id: Column.text(),
    inboxId: Column.text(),
    kind: Column.text(),
    label: Column.text(),
    armored: Column.text(),
    credential: Column.text().orNull(),
    createdAt: Column.int(),
  });

  export type Row = Table.Row<(typeof TABLE)['columns']>;

  export interface New {
    readonly kind: Unlock.Kind;
    readonly label: string;
    readonly wrapped: Wrapped;
    /**
     * For a passkey, the `AGE-PLUGIN-FIDO2PRF-1...` hint naming which credential
     * to ask for. Not a secret: it is a pointer, and useless without the
     * authenticator that holds the key.
     */
    readonly credential?: string;
  }

  export interface View {
    readonly id: string;
    readonly kind: Unlock.Kind;
    readonly label: string;
    readonly credential: string | null;
    readonly armored: string;
    readonly createdAt: number;
  }
}
