import { Code, Diag, Span } from '../core/diag/index.ts';
import { Cache } from './cache.ts';
import { Tenant } from './tenant.ts';

/**
 * Enough router for eight routes. A framework here would be a dependency in the
 * request path of a product whose pitch is that you need not trust it.
 */
export class App {
  static readonly PARAM = ':';
  static readonly GET = 'GET';
  static readonly HEAD = 'HEAD';

  private readonly routes: App.Route[] = [];

  /** Resolves inbox subdomains onto the path routes below. */
  constructor(private readonly tenant: Tenant = new Tenant(null)) {}

  route(method: string, path: App.Path, handler: App.Handler): this {
    this.routes.push({ method, segments: App.split(path.template), handler });
    return this;
  }

  get(path: App.Path, handler: App.Handler): this {
    return this.route('GET', path, handler);
  }

  post(path: App.Path, handler: App.Handler): this {
    return this.route('POST', path, handler);
  }

  delete(path: App.Path, handler: App.Handler): this {
    return this.route('DELETE', path, handler);
  }

  async fetch(request: Request): Promise<Response> {
    const url = this.tenant.rewrite(new URL(request.url));
    const path = App.split(url.pathname);
    // HEAD is GET without the body. Answering it as unrouted would report a page
    // as absent to anything that probes before fetching.
    const head = request.method === App.HEAD;
    const method = head ? App.GET : request.method;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = App.match(route.segments, path);
      if (!params) continue;
      try {
        return App.sealed(App.trim(await route.handler({ request, url, params }), head));
      } catch (cause) {
        return App.sealed(App.trim(App.failed(cause), head));
      }
    }

    const missing = Diag.of(Code.ROUTE_MISSING, `no route for ${request.method} ${url.pathname}`)
      .withSource(url.pathname, Span.whole(url.pathname, 'not mounted'))
      .withHelp(`known: ${this.routes.map((r) => `/${r.segments.join('/')}`).join(', ')}`);
    return App.sealed(missing.response());
  }

  /**
   * Diagnostics are answered as themselves. Anything else is logged in full and
   * answered as a bare internal error: a stack trace is not the caller's.
   */
  private static failed(cause: unknown): Response {
    if (cause instanceof Diag) return cause.response();
    console.error(cause);
    return Diag.of(Code.INTERNAL, 'internal error').response();
  }

  private static trim(response: Response, head: boolean): Response {
    return head ? new Response(null, response) : response;
  }

  /** One owner for the default: anything shaped by an inbox is never stored. */
  private static sealed(response: Response): Response {
    if (response.headers.has(Cache.HEADER)) return response;
    const sealed = new Response(response.body, response);
    sealed.headers.set(Cache.HEADER, Cache.NONE);
    return sealed;
  }

  private static split(path: string): string[] {
    return path.split('/').filter((s) => s.length > 0);
  }

  private static match(pattern: readonly string[], path: readonly string[]): App.Params | null {
    if (pattern.length !== path.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < pattern.length; i++) {
      const expected = pattern[i]!;
      const actual = path[i]!;
      if (expected.startsWith(App.PARAM)) params[expected.slice(App.PARAM.length)] = actual;
      else if (expected !== actual) return null;
    }
    return params;
  }
}

export namespace App {
  export type Params = Record<string, string>;
  export type Handler = (ctx: App.Ctx) => Response | Promise<Response>;

  /** The slice of `Route` a router needs, so `App` stays free of its generics. */
  export interface Path {
    readonly template: string;
  }

  export interface Ctx {
    readonly request: Request;
    readonly url: URL;
    readonly params: App.Params;
  }

  export interface Route {
    readonly method: string;
    readonly segments: readonly string[];
    readonly handler: App.Handler;
  }
}
