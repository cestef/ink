/// <reference types="@cloudflare/workers-types" />
import { Blobs } from '../blob/blobs.ts';
import { Api } from '../serve/api.ts';
import { App } from '../serve/app.ts';
import { Site } from '../serve/site.ts';
import { Tenant } from '../serve/tenant.ts';
import { Db } from '../store/db.ts';
import type { Driver } from '../store/driver.ts';

/**
 * Cloudflare target. Static bundles are served by the assets binding before this
 * runs, so nothing here touches them. The app is built once per isolate: routes
 * are static and migration is idempotent, so the cost is paid on a cold start
 * rather than per request.
 */
export class Cloud {
  private static ready: Promise<App> | null = null;

  static app(env: Cloud.Env): Promise<App> {
    Cloud.ready ??= Cloud.build(env);
    return Cloud.ready;
  }

  private static async build(env: Cloud.Env): Promise<App> {
    const db = new Db(new Cloud.D1(env.DB));
    await db.migrate();
    const domain = env.INK_DOMAIN ?? null;
    const ctx = { db, blobs: new Blobs.R2(env.BLOBS), domain };
    return Site.mount(Api.mount(new App(new Tenant(domain)), ctx), ctx);
  }
}

export namespace Cloud {
  export interface Env {
    readonly DB: D1Database;
    readonly BLOBS: R2Bucket;
    /** Serve each inbox on its own subdomain of this, if set. */
    readonly INK_DOMAIN?: string;
  }

  export class D1 implements Driver {
    constructor(private readonly db: D1Database) {}

    async run(sql: string, params: readonly Driver.Param[] = []): Promise<void> {
      await this.db
        .prepare(sql)
        .bind(...params)
        .run();
    }

    async all<T>(sql: string, params: readonly Driver.Param[] = []): Promise<T[]> {
      const result = await this.db
        .prepare(sql)
        .bind(...params)
        .all<T>();
      return result.results;
    }

    async get<T>(sql: string, params: readonly Driver.Param[] = []): Promise<T | null> {
      return this.db
        .prepare(sql)
        .bind(...params)
        .first<T>();
    }
  }
}

export default {
  async fetch(request: Request, env: Cloud.Env): Promise<Response> {
    return (await Cloud.app(env)).fetch(request);
  },
};
