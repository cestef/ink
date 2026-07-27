import { Column } from './column.ts';
import { Ddl } from './ddl.ts';
import type { Driver } from './driver.ts';
import { Table } from './table.ts';

export class Db {
  /** Which migrations have run. Declared like any other table, not by hand. */
  static readonly LEDGER = new Table('migration', {
    n: Column.int(),
    name: Column.text(),
  });

  static readonly LEDGER_DDL = Ddl.table(
    'migration',
    { n: 'INTEGER PRIMARY KEY', name: 'TEXT NOT NULL' },
    { ifNotExists: true },
  );

  static readonly MIGRATIONS: readonly Db.Migration[] = [
    {
      name: 'init',
      sql: [
        Ddl.table('inbox', {
          id: 'TEXT PRIMARY KEY',
          slug: 'TEXT NOT NULL UNIQUE',
          title: 'TEXT NOT NULL',
          recipient: 'TEXT NOT NULL',
          wrappedIdentity: 'TEXT NOT NULL',
          manageTokenHash: 'TEXT NOT NULL',
          createdAt: 'INTEGER NOT NULL',
        }),
        Ddl.table('submission', {
          id: 'TEXT PRIMARY KEY',
          inboxId: 'TEXT NOT NULL REFERENCES inbox(id)',
          blobKey: 'TEXT NOT NULL',
          size: 'INTEGER NOT NULL',
          createdAt: 'INTEGER NOT NULL',
          readAt: 'INTEGER',
        }),
        Ddl.index('submission_by_inbox', 'submission', ['inboxId', { field: 'createdAt', desc: true }]),
      ],
    },
    {
      // The single passphrase wrapping becomes one row among several, so an
      // inbox can be opened by a passkey, a passphrase, or both. Existing rows
      // move across before the column goes, since losing one is losing the key.
      name: 'unlock-methods',
      sql: [
        Ddl.table('wrapping', {
          id: 'TEXT PRIMARY KEY',
          inboxId: 'TEXT NOT NULL REFERENCES inbox(id)',
          kind: 'TEXT NOT NULL',
          label: 'TEXT NOT NULL',
          armored: 'TEXT NOT NULL',
          credential: 'TEXT',
          createdAt: 'INTEGER NOT NULL',
        }),
        Ddl.index('wrapping_by_inbox', 'wrapping', ['inboxId', 'createdAt']),
        Ddl.backfill({
          into: 'wrapping',
          from: 'inbox',
          values: {
            id: Ddl.raw(Ddl.ID),
            inboxId: 'id',
            kind: Ddl.value('passphrase'),
            label: Ddl.value('passphrase'),
            armored: 'wrappedIdentity',
            credential: Ddl.value(null),
            createdAt: 'createdAt',
          },
        }),
        Ddl.dropColumn('inbox', 'wrappedIdentity'),
      ],
    },
    {
      // Retention, so a secret stops existing once it has served its purpose.
      // Existing inboxes keep everything, since changing that under them would
      // delete data nobody asked to lose.
      name: 'retention',
      sql: [
        Ddl.addColumn('inbox', 'retain', 'INTEGER'),
        Ddl.addColumn('inbox', 'burn', 'INTEGER NOT NULL DEFAULT 0'),
      ],
    },
    {
      // Closing stops new submissions without destroying what is already held,
      // which is what people actually want when an engagement ends.
      name: 'closing',
      sql: [Ddl.addColumn('inbox', 'closedAt', 'INTEGER')],
    },
    {
      // What an inbox asks for. Labels only: a value never reaches the server
      // in any form, so nothing here could reconstruct a submission.
      name: 'fields',
      sql: [
        Ddl.table('field', {
          id: 'TEXT PRIMARY KEY',
          inboxId: 'TEXT NOT NULL REFERENCES inbox(id)',
          position: 'INTEGER NOT NULL',
          key: 'TEXT NOT NULL',
          label: 'TEXT NOT NULL',
          kind: 'TEXT NOT NULL',
          required: 'INTEGER NOT NULL DEFAULT 0',
        }),
        Ddl.index('field_by_inbox', 'field', ['inboxId', 'position']),
      ],
    },
  ];

  static get LATEST(): number {
    return Db.MIGRATIONS.length;
  }

  constructor(readonly driver: Driver) {}

  async migrate(): Promise<void> {
    await this.driver.run(Db.LEDGER_DDL);

    const last = await Db.LEDGER.select(this).order('n', 'desc').limit(1).one();
    const from = last?.n ?? 0;

    for (let n = from; n < Db.LATEST; n++) {
      const migration = Db.MIGRATIONS[n]!;
      for (const statement of migration.sql) await this.driver.run(statement);
      await Db.LEDGER.insert(this, { n: n + 1, name: migration.name });
    }
  }

  /** What the database actually has, for asserting the schema has not drifted. */
  async columns(table: string): Promise<string[]> {
    const rows = await this.driver.all<{ name: string }>(Ddl.columns(table));
    return rows.map((row) => row.name).sort();
  }

  async applied(): Promise<Db.Applied[]> {
    return Db.LEDGER.select(this).order('n', 'asc').all();
  }
}

export namespace Db {
  export interface Migration {
    readonly name: string;
    readonly sql: readonly string[];
  }

  export type Applied = Table.Row<(typeof Db.LEDGER)['columns']>;
}
