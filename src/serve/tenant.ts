import { Host } from '../core/host.ts';

/**
 * Turns a request on an inbox subdomain into the path-shaped one the router
 * already serves. One route table, two ways of addressing it: nothing
 * downstream needs to know which was used.
 */
export class Tenant {
  static readonly API = '/api';
  static readonly PAGE = '/i';

  constructor(private readonly domain: string | null) {}

  /** The inbox this request is for, or none when it is addressed by path. */
  host(url: URL): Host {
    return Host.of(url.hostname, this.domain);
  }

  /**
   * `acme.uses.ink/manage` becomes `/i/acme/manage`, and
   * `acme.uses.ink/api/submission` becomes `/api/inbox/acme/submission`.
   */
  rewrite(url: URL): URL {
    const host = this.host(url);
    if (host.kind !== 'inbox' || host.slug === null) return url;

    const path = url.pathname;
    const slug = encodeURIComponent(host.slug);

    const rewritten = path.startsWith(Tenant.API)
      ? `${Tenant.API}/inbox/${slug}${path.slice(Tenant.API.length)}`
      : `${Tenant.PAGE}/${slug}${path === '/' ? '' : path}`;

    const next = new URL(url);
    next.pathname = rewritten;
    return next;
  }

  /** Where an inbox lives, for the links a page hands out. */
  origin(url: URL, slug: string): string {
    if (!this.domain) return url.origin;

    const next = new URL(url);
    next.hostname = `${slug}.${this.domain.split(':')[0]}`;
    return next.origin;
  }
}
