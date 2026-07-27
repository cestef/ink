import { Code, Diag, Span } from '../core/diag/index.ts';
import { Id } from '../core/id.ts';
import type { Recipient } from '../core/recipient.ts';
import type { Slug } from '../core/slug.ts';
import { Token } from '../core/token.ts';
import { Column } from './column.ts';
import type { Db } from './db.ts';
import { Table } from './table.ts';

export class Inbox {
  static readonly TITLE_MAX = 120;

  private constructor(readonly row: Inbox.Row) {}

  static title(input: unknown): string {
    if (typeof input !== 'string') {
      throw Diag.of(Code.TITLE_INVALID, 'title must be text').withNote(`received ${typeof input}`);
    }
    const text = input.trim();
    if (text.length === 0) {
      throw Diag.of(Code.TITLE_INVALID, 'title is required').withHelp(
        'this is what the sender reads before handing over a secret, so say what you want',
      );
    }
    if (text.length > Inbox.TITLE_MAX) {
      throw Diag.of(Code.TITLE_INVALID, `title must be at most ${Inbox.TITLE_MAX} characters`)
        .withSource(text, Span.from(text, Inbox.TITLE_MAX, 'past the limit'))
        .withNote(`this one is ${text.length}`);
    }
    return text;
  }

  static async create(db: Db, input: Inbox.New): Promise<Inbox.Created> {
    const token = Token.make();
    const row: Inbox.Row = {
      id: Id.make(),
      slug: input.slug.value,
      title: input.title,
      recipient: input.recipient.value,
      manageTokenHash: await token.hash(),
      createdAt: Date.now(),
      retain: input.retain,
      burn: input.burn ? 1 : 0,
      closedAt: null,
    };

    try {
      await Inbox.TABLE.insert(db, row);
    } catch (cause) {
      const taken = await Inbox.TABLE.select(db).where({ slug: row.slug }).exists();
      if (!taken) throw cause;
      throw Diag.of(Code.SLUG_TAKEN, `"${row.slug}" is already in use`)
        .withSource(row.slug, Span.whole(row.slug, 'taken'))
        .withHelp('pick another address, this one belongs to an existing inbox');
    }

    return { inbox: new Inbox(row), token };
  }

  static async bySlug(db: Db, slug: Slug): Promise<Inbox> {
    const row = await Inbox.TABLE.select(db).where({ slug: slug.value }).one();
    if (!row) {
      throw Diag.of(Code.INBOX_MISSING, `no inbox at "${slug.value}"`)
        .withSource(slug.value, Span.whole(slug.value, 'never created, or deleted since'))
        .withHelp('check the link you were sent, the address is the part before the #');
    }
    return new Inbox(row);
  }

  get id(): string {
    return this.row.id;
  }

  /** Milliseconds submissions are kept, or null to keep until deleted. */
  get retain(): number | null {
    return this.row.retain;
  }

  /** Whether reading a submission destroys it. */
  get burn(): boolean {
    return this.row.burn === 1;
  }

  /** A closed inbox takes nothing new. What it already holds stays readable. */
  get closed(): boolean {
    return this.row.closedAt !== null;
  }

  async close(db: Db, closed: boolean): Promise<void> {
    await Inbox.TABLE.select(db)
      .where({ id: this.row.id })
      .update({ closedAt: closed ? Date.now() : null });
  }

  /** Refuses a new submission once closed, and says who can reopen it. */
  admits(): void {
    if (!this.closed) return;
    throw Diag.of(Code.INBOX_CLOSED, 'this inbox is not accepting submissions')
      .withHelp('ask the person who sent you the link to reopen it')
      .withNote('what it already holds is untouched');
  }

  /**
   * Mints a new manage token and forgets the old one. The only way to revoke a
   * leaked manage link short of deleting the inbox.
   */
  async rotate(db: Db): Promise<Token> {
    const token = Token.make();
    await Inbox.TABLE.select(db)
      .where({ id: this.row.id })
      .update({ manageTokenHash: await token.hash() });
    return token;
  }

  /** Removes the inbox itself. Callers clear its contents first. */
  async remove(db: Db): Promise<void> {
    await Inbox.TABLE.select(db).where({ id: this.row.id }).delete();
  }

  /** Metadata a stranger may see before submitting. Never the wrapped identity. */
  view(): Inbox.View {
    return { slug: this.row.slug, title: this.row.title, recipient: this.row.recipient };
  }

  policy(): Inbox.Policy {
    return { retain: this.retain, burn: this.burn, closed: this.closed };
  }

  async authorise(request: Request): Promise<void> {
    await Token.from(request).check(this.row.manageTokenHash);
  }
}

export namespace Inbox {
  export const TABLE = new Table('inbox', {
    id: Column.text(),
    slug: Column.text(),
    title: Column.text(),
    recipient: Column.text(),
    manageTokenHash: Column.text(),
    createdAt: Column.int(),
    retain: Column.int().orNull(),
    burn: Column.int(),
    closedAt: Column.int().orNull(),
  });

  export type Row = Table.Row<(typeof TABLE)['columns']>;

  export interface New {
    readonly slug: Slug;
    readonly title: string;
    readonly recipient: Recipient;
    /** Milliseconds to keep submissions, or null to keep them until deleted. */
    readonly retain: number | null;
    readonly burn: boolean;
  }

  export interface Created {
    readonly inbox: Inbox;
    readonly token: Token;
  }

  export interface View {
    readonly slug: string;
    readonly title: string;
    readonly recipient: string;
  }

  export interface Policy {
    readonly retain: number | null;
    readonly burn: boolean;
    readonly closed: boolean;
  }
}
