import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { Slug } from '../src/core/slug.ts';
import { Local } from '../src/host/local.ts';
import { Db } from '../src/store/db.ts';
import { Inbox } from '../src/store/inbox.ts';
import { Name } from '../src/store/name.ts';
import { Submission } from '../src/store/submission.ts';
import type { Table } from '../src/store/table.ts';
import { Wrapping } from '../src/store/wrapping.ts';

class Fixture {
  static async db(): Promise<Db> {
    const db = new Db(new Local.Sqlite(new Database(':memory:')));
    await db.migrate();
    return db;
  }

  /** A real inbox row, since anything reading policy needs more than an id. */
  static async inbox(db: Db, slug: string): Promise<Inbox> {
    await Inbox.TABLE.insert(db, {
      id: slug,
      slug,
      title: slug,
      recipient: 'age1test',
      manageTokenHash: 'hash',
      createdAt: 1,
      retain: null,
      burn: 0,
      closedAt: null,
    });
    return Inbox.bySlug(db, Slug.parse(slug));
  }

  static derived<S extends Table.Shape>(table: Table<S>): string[] {
    return table.fields.map((field) => Name.snake(field)).sort();
  }
}

describe('migrations', () => {
  test('LATEST is derived from the list, never restated', async () => {
    const db = await Fixture.db();
    expect(Db.LATEST).toBe(Db.MIGRATIONS.length);
    expect((await db.applied()).map((row) => row.name)).toEqual(Db.MIGRATIONS.map((m) => m.name));

    // Migrating again is a no-op, never a replay.
    await db.migrate();
    expect((await db.applied()).length).toBe(Db.LATEST);
  });
});

/**
 * The typed tables derive their column names, while migrations are literal.
 * That is two sources for one truth unless something compares them, so this is
 * the test that keeps the seam honest.
 */
describe('schema drift', () => {
  test('every declared field exists as a column, and nothing else does', async () => {
    const db = await Fixture.db();
    expect(await db.columns('inbox')).toEqual(Fixture.derived(Inbox.TABLE));
    expect(await db.columns('submission')).toEqual(Fixture.derived(Submission.TABLE));
    expect(await db.columns('wrapping')).toEqual(Fixture.derived(Wrapping.TABLE));
  });

  test('camelCase fields become snake_case columns', () => {
    expect(Name.snake('wrappedIdentity')).toBe('wrapped_identity');
    expect(Name.snake('id')).toBe('id');
    expect(Wrapping.TABLE.selection).toContain('inbox_id AS inboxId');
    expect(Inbox.TABLE.selection).toContain('id,');
  });
});

describe('query builder', () => {
  test('round trips a row through insert, filter and update', async () => {
    const db = await Fixture.db();
    const row = {
      id: 'a1',
      slug: 'acme',
      title: 'client credentials',
      recipient: 'age1test',
      manageTokenHash: 'hash',
      createdAt: 1,
      retain: null,
      burn: 0,
      closedAt: null,
    };
    await Inbox.TABLE.insert(db, row);

    expect(await Inbox.TABLE.select(db).where({ slug: 'acme' }).one()).toEqual(row);
    expect(await Inbox.TABLE.select(db).where({ slug: 'nope' }).one()).toBeNull();
    expect(await Inbox.TABLE.select(db).where({ slug: 'acme' }).exists()).toBe(true);
    expect(await Inbox.TABLE.select(db).where({ slug: 'nope' }).exists()).toBe(false);

    await Inbox.TABLE.select(db).where({ id: 'a1' }).update({ title: 'renamed' });
    const after = await Inbox.TABLE.select(db).where({ id: 'a1' }).one();
    expect(after?.title).toBe('renamed');
  });

  test('orders and limits without leaking sql to the caller', async () => {
    const db = await Fixture.db();
    for (const [i, id] of ['s1', 's2', 's3'].entries()) {
      await Submission.TABLE.insert(db, {
        id,
        inboxId: 'box',
        blobKey: 'ff',
        size: 10 + i,
        createdAt: i,
        readAt: null,
      });
    }

    const newest = await Submission.TABLE.select(db)
      .where({ inboxId: 'box' })
      .order('createdAt', 'desc')
      .all();
    expect(newest.map((row) => row.id)).toEqual(['s3', 's2', 's1']);

    const oldest = await Submission.TABLE.select(db).order('createdAt', 'asc').limit(2).all();
    expect(oldest.map((row) => row.id)).toEqual(['s1', 's2']);
  });

  test('a listing is capped, and says so rather than truncating quietly', async () => {
    const db = await Fixture.db();
    // A real inbox, not a cast: listing reads its retention policy.
    const inbox = await Fixture.inbox(db, 'capped');
    const other = await Fixture.inbox(db, 'empty');

    for (let i = 0; i <= Submission.PAGE; i++) {
      await Submission.TABLE.insert(db, {
        id: `s${i}`,
        inboxId: inbox.id,
        blobKey: 'ff',
        size: 1,
        createdAt: i + 1,
        readAt: null,
      });
    }

    const full = await Submission.list(db, inbox);
    expect(full.submissions.length).toBe(Submission.PAGE);
    expect(full.more).toBe(true);
    // Newest first survives the cap: the oldest row is the one dropped.
    expect(full.submissions[0]?.id).toBe(`s${Submission.PAGE}`);

    const short = await Submission.list(db, other);
    expect(short.submissions.length).toBe(0);
    expect(short.more).toBe(false);
  });

  /**
   * Submissions arriving in the same millisecond used to come back either way
   * round, which only showed up once the suite got fast enough to write them
   * that quickly. A timestamp in milliseconds is not an ordering.
   */
  test('rows written in the same millisecond still list newest first', async () => {
    const db = await Fixture.db();
    const inbox = await Fixture.inbox(db, 'sametick');
    const at = Date.now();

    for (const id of ['s1', 's2', 's3', 's4', 's5']) {
      await Submission.TABLE.insert(db, {
        id,
        inboxId: inbox.id,
        blobKey: 'ff',
        size: 1,
        createdAt: at,
        readAt: null,
      });
    }

    const page = await Submission.list(db, inbox);
    expect(page.submissions.map((row) => row.id)).toEqual(['s5', 's4', 's3', 's2', 's1']);
  });

  test('a nullable column round trips null', async () => {
    const db = await Fixture.db();
    await Submission.TABLE.insert(db, {
      id: 'n1',
      inboxId: 'box',
      blobKey: 'ab',
      size: 1,
      createdAt: 0,
      readAt: null,
    });
    expect((await Submission.TABLE.select(db).where({ id: 'n1' }).one())?.readAt).toBeNull();

    await Submission.TABLE.select(db).where({ id: 'n1' }).update({ readAt: 99 });
    expect((await Submission.TABLE.select(db).where({ id: 'n1' }).one())?.readAt).toBe(99);
  });
});
