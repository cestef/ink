import type { Blobs } from '../blob/blobs.ts';
import { Code, Diag, Span } from '../core/diag/index.ts';
import { Id } from '../core/id.ts';
import { Retention } from '../core/retention.ts';
import { Column } from './column.ts';
import type { Db } from './db.ts';
import type { Inbox } from './inbox.ts';
import { Table } from './table.ts';

export class Submission {
  /**
   * One submission is one age file: a tar of every field, so it stays openable
   * with `age -d | tar -x`. Sized for a form with a document attached, not for
   * archives.
   */
  static readonly MAX = 10 * 1024 * 1024;

  /** How many a single listing returns. Paging comes with the dashboard. */
  static readonly PAGE = 200;

  /**
   * Submitting needs no credential, by design, so the only thing standing
   * between a forwarded link and an unbounded write is this. Both bounds are
   * per inbox: whoever holds the link can fill their own inbox and nobody
   * else's. Per-IP limiting is a separate concern and belongs at the edge.
   */
  static readonly QUOTA = 500;
  static readonly QUOTA_BYTES = 100 * 1024 * 1024;

  private constructor(readonly row: Submission.Row) {}

  static async accept(db: Db, blobs: Blobs, inbox: Inbox, body: Blobs.Bytes): Promise<Submission> {
    inbox.admits();
    if (body.byteLength === 0) {
      throw Diag.of(Code.SUBMISSION_EMPTY, 'nothing to store').withHelp(
        'the body must be an age file, encrypted in the browser before it is sent',
      );
    }
    if (body.byteLength > Submission.MAX) {
      throw Diag.of(Code.SUBMISSION_LARGE, `submissions are capped at ${Submission.MAX} bytes`)
        .withHelp('attach fewer or smaller files')
        .withNote(`received ${body.byteLength}`);
    }

    // Expired submissions must not hold space against the next sender, so the
    // sweep runs here rather than waiting for a scheduler that may never run.
    await Submission.sweep(db, blobs, inbox);
    await Submission.room(db, inbox, body.byteLength);

    const row: Submission.Row = {
      id: Id.make(),
      inboxId: inbox.id,
      blobKey: Id.make(),
      size: body.byteLength,
      createdAt: Date.now(),
      readAt: null,
    };
    await blobs.put(row.blobKey, body);
    await Submission.TABLE.insert(db, row);
    return new Submission(row);
  }

  /**
   * Refuses before writing, and says which bound was hit. The owner can still
   * read and clear what is already there, so a flood denies new submissions
   * rather than destroying old ones.
   */
  private static async room(db: Db, inbox: Inbox, incoming: number): Promise<void> {
    const held = await Submission.TABLE.select(db).where({ inboxId: inbox.id }).tally('size');

    if (held.rows >= Submission.QUOTA) {
      throw Diag.of(Code.SUBMISSION_QUOTA, `this inbox already holds ${Submission.QUOTA} submissions`)
        .withHelp('the recipient can delete submissions, or set a shorter retention period')
        .withNote(`the cap is ${Submission.QUOTA}`);
    }

    if (held.total + incoming > Submission.QUOTA_BYTES) {
      throw Diag.of(Code.SUBMISSION_QUOTA, 'this inbox is out of space')
        .withHelp('the recipient can delete submissions, or set a shorter retention period')
        .withNote(`holding ${held.total} of ${Submission.QUOTA_BYTES} bytes`);
    }
  }

  /** Deletes one submission: bytes first, so a crash never leaks a blob. */
  static async remove(db: Db, blobs: Blobs, inbox: Inbox, id: string): Promise<void> {
    const submission = await Submission.byId(db, inbox, id, { expired: true });
    await submission.destroy(db, blobs);
  }

  /** Deletes everything an inbox holds. Used when the inbox itself goes. */
  static async clear(db: Db, blobs: Blobs, inbox: Inbox): Promise<number> {
    const rows = await Submission.TABLE.select(db).where({ inboxId: inbox.id }).all();
    for (const row of rows) await new Submission(row).destroy(db, blobs);
    return rows.length;
  }

  /** Removes whatever has outlived the inbox's retention. */
  static async sweep(db: Db, blobs: Blobs, inbox: Inbox): Promise<number> {
    if (inbox.retain === null) return 0;

    const cutoff = Date.now() - inbox.retain;
    const rows = await Submission.TABLE.select(db).where({ inboxId: inbox.id }).all();
    const stale = rows.filter((row) => row.createdAt <= cutoff);

    for (const row of stale) await new Submission(row).destroy(db, blobs);
    return stale.length;
  }

  private async destroy(db: Db, blobs: Blobs): Promise<void> {
    await blobs.delete(this.row.blobKey);
    await Submission.TABLE.select(db).where({ id: this.row.id }).delete();
  }

  /**
   * Newest first, capped. An unbounded listing turns a busy inbox into a slow
   * one, and the cap is reported rather than applied quietly, because a silent
   * truncation reads as "this is everything" when it is not.
   */
  static async list(db: Db, inbox: Inbox): Promise<Submission.Page> {
    const query = Submission.TABLE.select(db).where({ inboxId: inbox.id });
    // Expiry is applied on the read path, so an expired secret is unreadable
    // even if no sweep has run since it lapsed.
    if (inbox.retain !== null) query.after('createdAt', Date.now() - inbox.retain);

    const rows = await query
      .order('createdAt', 'desc')
      .stable('desc')
      .limit(Submission.PAGE + 1)
      .all();

    return {
      submissions: rows.slice(0, Submission.PAGE).map((row) => new Submission(row)),
      more: rows.length > Submission.PAGE,
    };
  }

  static async byId(db: Db, inbox: Inbox, id: string, reach: Submission.Reach = {}): Promise<Submission> {
    const row = await Submission.TABLE.select(db).where({ id, inboxId: inbox.id }).one();
    if (!row) {
      throw Diag.of(Code.SUBMISSION_MISSING, 'no such submission')
        .withSource(id, Span.whole(id, 'not in this inbox'))
        .withNote('a submission is only ever readable through the inbox it was sent to');
    }

    if (!reach.expired && Retention.expired(inbox.retain, row.createdAt, Date.now())) {
      throw Diag.of(Code.SUBMISSION_EXPIRED, 'this submission has expired')
        .withHelp(`this inbox is set to ${Retention.label(inbox.retain).toLowerCase()}`)
        .withNote('it is unreadable now and its bytes go on the next write to this inbox');
    }

    return new Submission(row);
  }

  get id(): string {
    return this.row.id;
  }

  /**
   * Returns the ciphertext, and destroys it if the inbox burns on read. The
   * delete happens after the bytes are in hand, so a failure to read leaves the
   * submission intact rather than consuming it for nothing.
   */
  async bytes(db: Db, blobs: Blobs, inbox: Inbox): Promise<Blobs.Bytes> {
    const data = await blobs.get(this.row.blobKey);
    if (!data) {
      throw Diag.of(Code.SUBMISSION_MISSING, 'the ciphertext for this submission is gone')
        .withNote(`blob ${this.row.blobKey} is absent from storage`)
        .withHelp('the row survived but its bytes did not, which means storage lost them');
    }

    if (inbox.burn) {
      await this.destroy(db, blobs);
      return data;
    }

    if (this.row.readAt === null) {
      await Submission.TABLE.select(db).where({ id: this.row.id }).update({ readAt: Date.now() });
    }
    return data;
  }

  view(): Submission.View {
    return {
      id: this.row.id,
      size: this.row.size,
      createdAt: this.row.createdAt,
      readAt: this.row.readAt,
    };
  }
}

export namespace Submission {
  /** Whether a lookup may reach a submission retention has already lapsed. */
  export interface Reach {
    readonly expired?: boolean;
  }

  export interface Page {
    readonly submissions: readonly Submission[];
    readonly more: boolean;
  }

  export const TABLE = new Table('submission', {
    id: Column.text(),
    inboxId: Column.text(),
    blobKey: Column.text(),
    size: Column.int(),
    createdAt: Column.int(),
    readAt: Column.int().orNull(),
  });

  export type Row = Table.Row<(typeof TABLE)['columns']>;

  export interface View {
    readonly id: string;
    readonly size: number;
    readonly createdAt: number;
    readonly readAt: number | null;
  }
}
