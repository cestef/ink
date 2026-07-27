import type { Blobs } from '../blob/blobs.ts';
import { Code, Diag } from '../core/diag/index.ts';
import { Field } from '../core/field.ts';
import { Recipient } from '../core/recipient.ts';
import { Retention } from '../core/retention.ts';
import { Routes } from '../core/routes.ts';
import { Slug } from '../core/slug.ts';
import { Unlock } from '../core/unlock.ts';
import { Wrapped } from '../core/wrapped.ts';
import type { Db } from '../store/db.ts';
import { Inbox } from '../store/inbox.ts';
import { Schema } from '../store/schema.ts';
import { Submission } from '../store/submission.ts';
import { Wrapping } from '../store/wrapping.ts';
import type { App } from './app.ts';

export class Api {
  static readonly BYTES = 'application/octet-stream';
  static readonly TEXT = 'text/plain; charset=utf-8';

  static mount(app: App, ctx: Api.Ctx): App {
    app.post(Routes.api.create, async ({ request }) => {
      const body = await Api.body(request);
      const wrappings = Api.wrappings(body.wrappings);
      const fields = Field.all(body.fields);

      const created = await Inbox.create(ctx.db, {
        slug: Slug.parse(body.slug),
        title: Inbox.title(body.title),
        recipient: Recipient.parse(body.recipient),
        retain: Retention.parse(body.retain),
        burn: body.burn === true,
      });
      for (const wrapping of wrappings) await Wrapping.write(ctx.db, created.inbox, wrapping);
      await Schema.write(ctx.db, created.inbox, fields);

      return Response.json({ inbox: created.inbox.view(), token: created.token.secret }, { status: 201 });
    });

    app.post(Routes.api.key, async ({ request, params }) => {
      const inbox = await Api.owned(ctx, params, request);
      const [wrapping] = Api.wrappings(await Api.body(request).then((body) => body.wrappings));
      const added = await Wrapping.add(ctx.db, inbox, wrapping!);
      return Response.json({ wrapping: added.view() }, { status: 201 });
    });

    app.delete(Routes.api.inbox, async ({ request, params }) => {
      const inbox = await Api.owned(ctx, params, request);
      // Contents before the inbox: a half-deleted inbox that still holds
      // ciphertext is worse than one that failed to go at all.
      const cleared = await Submission.clear(ctx.db, ctx.blobs, inbox);
      await Wrapping.clear(ctx.db, inbox);
      await Schema.clear(ctx.db, inbox);
      await inbox.remove(ctx.db);
      return Response.json({ deleted: cleared });
    });

    app.post(Routes.api.state, async ({ request, params }) => {
      const inbox = await Api.owned(ctx, params, request);
      const body = await Api.body(request);
      await inbox.close(ctx.db, body.closed === true);
      return Response.json({ closed: body.closed === true });
    });

    app.post(Routes.api.token, async ({ request, params }) => {
      const inbox = await Api.owned(ctx, params, request);
      const token = await inbox.rotate(ctx.db);
      return Response.json({ token: token.secret });
    });

    app.delete(Routes.api.submission, async ({ request, params }) => {
      const inbox = await Api.owned(ctx, params, request);
      await Submission.remove(ctx.db, ctx.blobs, inbox, params.id ?? '');
      return new Response(null, { status: 204 });
    });

    app.delete(Routes.api.wrapping, async ({ request, params }) => {
      const inbox = await Api.owned(ctx, params, request);
      await Wrapping.remove(ctx.db, inbox, params.id ?? '');
      return new Response(null, { status: 204 });
    });

    app.post(Routes.api.submissions, async ({ request, params }) => {
      const inbox = await Api.inbox(ctx, params);
      const body = new Uint8Array(await request.arrayBuffer());
      const submission = await Submission.accept(ctx.db, ctx.blobs, inbox, body);
      return Response.json({ id: submission.id }, { status: 201 });
    });

    app.get(Routes.api.key, async ({ request, params }) => {
      const inbox = await Api.owned(ctx, params, request);
      const wrappings = await Wrapping.list(ctx.db, inbox);
      return Response.json({ wrappings: wrappings.map((wrapping) => wrapping.view()) });
    });

    app.get(Routes.api.submissions, async ({ request, params }) => {
      const inbox = await Api.owned(ctx, params, request);
      const page = await Submission.list(ctx.db, inbox);
      return Response.json({
        submissions: page.submissions.map((s) => s.view()),
        more: page.more,
        limit: Submission.PAGE,
        policy: inbox.policy(),
      });
    });

    app.get(Routes.api.submission, async ({ request, params }) => {
      const inbox = await Api.owned(ctx, params, request);
      const submission = await Submission.byId(ctx.db, inbox, params.id ?? '');
      const bytes = await submission.bytes(ctx.db, ctx.blobs, inbox);
      return new Response(bytes, {
        headers: {
          'content-type': Api.BYTES,
          'content-disposition': `attachment; filename="${submission.id}.age"`,
        },
      });
    });

    return app;
  }

  private static async inbox(ctx: Api.Ctx, params: App.Params): Promise<Inbox> {
    return Inbox.bySlug(ctx.db, Slug.parse(params.slug));
  }

  private static async owned(ctx: Api.Ctx, params: App.Params, request: Request): Promise<Inbox> {
    const inbox = await Api.inbox(ctx, params);
    await inbox.authorise(request);
    return inbox;
  }

  /**
   * An inbox with no unlock method is an inbox whose submissions can never be
   * read, so refusing here is the only place that stays cheap.
   */
  private static wrappings(input: unknown): Wrapping.New[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw Diag.of(Code.WRAPPING_NONE, 'an inbox needs at least one way to unlock it')
        .withHelp('send wrappings: [{kind, label, wrapped}]')
        .withNote('the server cannot open any of them, it only stores them');
    }

    return input.map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const kind = Unlock.parse(record.kind);
      const credential = record.credential;

      return {
        kind,
        label: Unlock.label(record.label, kind),
        wrapped: Wrapped.parse(record.wrapped),
        ...(typeof credential === 'string' ? { credential } : {}),
      };
    });
  }

  private static async body(request: Request): Promise<Record<string, unknown>> {
    const value: unknown = await request.json().catch(() => null);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw Diag.of(Code.BODY_INVALID, 'expected a JSON object')
        .withHelp('send {slug, title, recipient, wrapped}')
        .withNote(`received ${Array.isArray(value) ? 'an array' : String(value)}`);
    }
    return value as Record<string, unknown>;
  }
}

export namespace Api {
  export interface Ctx {
    readonly db: Db;
    readonly blobs: Blobs;
    /** The domain inboxes get subdomains of, or null for path addressing. */
    readonly domain?: string | null;
  }
}
