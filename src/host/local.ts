import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { Blobs } from '../blob/blobs.ts';
import { Api } from '../serve/api.ts';
import { App } from '../serve/app.ts';
import { Cache } from '../serve/cache.ts';
import { Site } from '../serve/site.ts';
import { Tenant } from '../serve/tenant.ts';
import { Db } from '../store/db.ts';
import type { Driver } from '../store/driver.ts';

/** Self-hosted target: a single process, a file, and a directory of blobs. */
export class Local {
  static readonly PORT = 8787;
  static readonly HOME = '.ink';
  static readonly ASSETS = 'public';
  static readonly PREFIX = '/js/';
  static readonly TYPES: Record<string, string> = {
    js: 'text/javascript; charset=utf-8',
    map: 'application/json',
  };

  /** Set INK_DOMAIN to serve each inbox on its own subdomain of it. */
  static async open(home = Local.HOME): Promise<Local> {
    await mkdir(home, { recursive: true });
    const db = new Db(new Local.Sqlite(new Database(`${home}/ink.db`, { create: true })));
    await db.migrate();

    const domain = process.env.INK_DOMAIN ?? null;
    const ctx = { db, blobs: new Blobs.Fs(`${home}/blobs`), domain };
    return new Local(Site.mount(Api.mount(new App(new Tenant(domain)), ctx), ctx));
  }

  private constructor(private readonly app: App) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    return url.pathname.startsWith(Local.PREFIX) ? Local.asset(url.pathname) : this.app.fetch(request);
  }

  private static async asset(pathname: string): Promise<Response> {
    const file = Bun.file(`${Local.ASSETS}${pathname}`);
    if (!(await file.exists())) return new Response('not found', { status: 404 });
    const kind = pathname.split('.').pop() ?? '';
    return new Response(file, {
      headers: {
        'content-type': Local.TYPES[kind] ?? 'application/octet-stream',
        [Cache.HEADER]: Cache.ASSET,
      },
    });
  }

  static async main(): Promise<void> {
    const local = await Local.open();
    const server = Bun.serve({ port: Local.PORT, fetch: (request) => local.fetch(request) });
    console.error(`ink on ${server.url}`);
  }
}

export namespace Local {
  export class Sqlite implements Driver {
    constructor(private readonly db: Database) {}

    async run(sql: string, params: readonly Driver.Param[] = []): Promise<void> {
      this.db.query(sql).run(...(params as SQLQueryBindings[]));
    }

    async all<T>(sql: string, params: readonly Driver.Param[] = []): Promise<T[]> {
      return this.db.query(sql).all(...(params as SQLQueryBindings[])) as T[];
    }

    async get<T>(sql: string, params: readonly Driver.Param[] = []): Promise<T | null> {
      return (this.db.query(sql).get(...(params as SQLQueryBindings[])) as T | null) ?? null;
    }
  }
}

if (import.meta.main) await Local.main();
