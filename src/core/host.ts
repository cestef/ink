import { Slug } from './slug.ts';

/**
 * Which inbox a request is for, read from the hostname.
 *
 * `acme.uses.ink` is the inbox `acme`, and every path on it is that inbox's:
 * `/` is where a stranger submits, `/manage` is where the owner reads. The apex
 * is where inboxes are created.
 *
 * Isolating each inbox on its own origin is worth more than the tidy URL. A
 * passkey enrolled on `acme.uses.ink` is scoped to that host by default, so it
 * cannot be used against another inbox, and neither can anything else the
 * browser keys by origin.
 *
 * With no domain configured, or on a host that is not under it (localhost, a
 * preview deployment, an IP), everything falls back to paths and nothing is
 * rewritten.
 */
export class Host {
  static readonly WWW = 'www';

  private constructor(
    readonly kind: Host.Kind,
    readonly slug: string | null,
  ) {}

  static readonly PATHS = new Host('paths', null);
  static readonly APEX = new Host('apex', null);

  static of(hostname: string, domain: string | null): Host {
    if (!domain) return Host.PATHS;

    const host = Host.bare(hostname);
    const base = Host.bare(domain);

    if (host === base || host === `${Host.WWW}.${base}`) return Host.APEX;
    if (!host.endsWith(`.${base}`)) return Host.PATHS;

    const label = host.slice(0, -(base.length + 1));
    // A deeper name is not an inbox: `a.b.uses.ink` must not resolve to `a`.
    if (label.includes('.') || !Host.labelled(label)) return Host.PATHS;

    return new Host('inbox', label);
  }

  /** Strips a port, and lowercases, so `ACME.uses.ink:8787` still resolves. */
  private static bare(hostname: string): string {
    return hostname.toLowerCase().split(':')[0] ?? '';
  }

  private static labelled(label: string): boolean {
    return Slug.SHAPE.test(label) && label.length >= Slug.MIN && label.length <= Slug.MAX;
  }
}

export namespace Host {
  export type Kind = 'paths' | 'apex' | 'inbox';
}
