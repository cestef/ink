import { Host } from '../core/host.ts';
import { Routes } from '../core/routes.ts';
import { Fault } from './fault.ts';
import { Ui } from './ui.ts';

/**
 * Every request the browser makes. Call sites name an operation, never a path,
 * so no URL is assembled outside `Routes`.
 */
export class Client {
  static readonly TOKEN = 'x-ink-token';
  static readonly JSON = 'application/json';
  static readonly BYTES = 'application/octet-stream';

  private constructor(
    private readonly slug: string,
    private readonly token: string | null,
  ) {}

  static anonymous(slug: string): Client {
    return new Client(slug, null);
  }

  static owner(slug: string, token: string): Client {
    if (!token) {
      throw Fault.of(
        'token.missing',
        'incomplete link',
        'this manage link is missing its token',
        'the token is the part after the #, which some chat clients strip',
      );
    }
    return new Client(slug, token);
  }

  static async create(input: Client.New): Promise<Client.Created> {
    const response = await fetch(Routes.api.create.path(), {
      method: 'POST',
      headers: { 'content-type': Client.JSON },
      body: JSON.stringify(input),
    });
    return Client.json<Client.Created>(response);
  }

  /**
   * Where an inbox lives. With a domain configured every inbox gets its own
   * origin, which is what keeps one inbox's passkey from reaching another.
   * Without one, everything stays on paths.
   */
  private static origin(slug: string): string | null {
    const domain = Ui.data('root', 'domain');
    if (!domain) return null;

    const url = new URL(location.href);
    url.hostname = `${slug}.${domain}`;
    return url.origin;
  }

  static link(slug: string, recipient: string): string {
    const origin = Client.origin(slug);
    return origin
      ? Routes.site.submit.url(origin, undefined, recipient)
      : Routes.page.inbox.url(location.origin, { slug }, recipient);
  }

  static manage(slug: string, token: string): string {
    const origin = Client.origin(slug);
    return origin
      ? Routes.site.manage.url(origin, undefined, token)
      : Routes.page.manage.url(location.origin, { slug }, token);
  }

  /** The absolute submit endpoint, for the terminal path that skips this page. */
  static endpoint(slug: string): string {
    const origin = Client.origin(slug);
    return origin
      ? Routes.site.submissions.url(origin, undefined)
      : Routes.api.submissions.url(location.origin, { slug });
  }

  async submit(ciphertext: Uint8Array): Promise<void> {
    const response = await this.send(
      this.at(
        () => Routes.site.submissions.path(),
        (slug) => Routes.api.submissions.path({ slug }),
      ),
      {
        method: 'POST',
        headers: { 'content-type': Client.BYTES },
        // Copied into an owned buffer: age hands back a view over a shared one.
        body: new Blob([new Uint8Array(ciphertext)]),
      },
    );
    await Client.json<{ id: string }>(response);
  }

  private key(): string {
    return this.at(
      () => Routes.site.key.path(),
      (slug) => Routes.api.key.path({ slug }),
    );
  }

  async wrappings(): Promise<Client.Wrapping[]> {
    const response = await this.send(this.key(), {});
    const body = await Client.json<{ wrappings: Client.Wrapping[] }>(response);
    return body.wrappings;
  }

  async enrol(wrapping: Client.New['wrappings'][number]): Promise<Client.Wrapping> {
    const response = await this.send(this.key(), {
      method: 'POST',
      headers: { 'content-type': Client.JSON },
      body: JSON.stringify({ wrappings: [wrapping] }),
    });
    const body = await Client.json<{ wrapping: Client.Wrapping }>(response);
    return body.wrapping;
  }

  /** Deletes one submission. */
  async discard(id: string): Promise<void> {
    const url = this.at(
      () => Routes.site.submission.path({ id }),
      (slug) => Routes.api.submission.path({ slug, id }),
    );
    await Client.ok(await this.send(url, { method: 'DELETE' }));
  }

  /** Deletes the inbox and everything it holds. */
  async destroy(): Promise<number> {
    const url = this.at(
      () => Routes.site.inbox.path(),
      (slug) => Routes.api.inbox.path({ slug }),
    );
    return (await Client.json<{ deleted: number }>(await this.send(url, { method: 'DELETE' }))).deleted;
  }

  /** Stops or resumes new submissions, without touching what is held. */
  async close(closed: boolean): Promise<boolean> {
    const url = this.at(
      () => Routes.site.state.path(),
      (slug) => Routes.api.state.path({ slug }),
    );
    const response = await this.send(url, {
      method: 'POST',
      headers: { 'content-type': Client.JSON },
      body: JSON.stringify({ closed }),
    });
    return (await Client.json<{ closed: boolean }>(response)).closed;
  }

  /** Mints a new manage link and invalidates the current one. */
  async rotate(): Promise<string> {
    const url = this.at(
      () => Routes.site.token.path(),
      (slug) => Routes.api.token.path({ slug }),
    );
    return (await Client.json<{ token: string }>(await this.send(url, { method: 'POST' }))).token;
  }

  async forget(id: string): Promise<void> {
    const url = this.at(
      () => Routes.site.wrapping.path({ id }),
      (slug) => Routes.api.wrapping.path({ slug, id }),
    );
    await Client.ok(await this.send(url, { method: 'DELETE' }));
  }

  async submissions(): Promise<Client.Page> {
    const url = this.at(
      () => Routes.site.submissions.path(),
      (slug) => Routes.api.submissions.path({ slug }),
    );
    return Client.json<Client.Page>(await this.send(url, {}));
  }

  async ciphertext(id: string): Promise<Uint8Array> {
    const url = this.at(
      () => Routes.site.submission.path({ id }),
      (slug) => Routes.api.submission.path({ slug, id }),
    );
    const response = await this.send(url, {});
    await Client.ok(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * On an inbox host the slug is the hostname, so the path must not repeat it.
   * Asking for the path form here would have the inbox spliced in twice by the
   * time the router sees it.
   */
  private get hosted(): boolean {
    const domain = Ui.data('root', 'domain');
    return Host.of(location.hostname, domain || null).kind === 'inbox';
  }

  private at(byHost: () => string, byPath: (slug: string) => string): string {
    return this.hosted ? byHost() : byPath(this.slug);
  }

  private send(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, headers: { ...this.headers(), ...init.headers } });
  }

  private headers(): Record<string, string> {
    return this.token ? { [Client.TOKEN]: this.token } : {};
  }

  private static async ok(response: Response): Promise<void> {
    if (!response.ok) throw await Fault.from(response);
  }

  private static async json<T>(response: Response): Promise<T> {
    if (!response.ok) throw await Fault.from(response);
    return (await response.json()) as T;
  }
}

export namespace Client {
  export interface New {
    readonly slug: string;
    readonly title: string;
    readonly recipient: string;
    readonly retain: string;
    readonly burn: boolean;
    readonly fields: readonly { readonly label: string; readonly kind: string; readonly required: boolean }[];
    readonly wrappings: readonly {
      readonly kind: string;
      readonly label: string;
      readonly wrapped: string;
      readonly credential?: string;
    }[];
  }

  export interface Wrapping {
    readonly id: string;
    readonly kind: 'passkey' | 'passphrase';
    readonly label: string;
    readonly credential: string | null;
    readonly armored: string;
    readonly createdAt: number;
  }

  export interface Created {
    readonly token: string;
  }

  export interface Page {
    readonly submissions: readonly Client.View[];
    readonly more: boolean;
    readonly limit: number;
    readonly policy: Client.Policy;
  }

  export interface Policy {
    readonly retain: number | null;
    readonly burn: boolean;
    readonly closed: boolean;
  }

  export interface View {
    readonly id: string;
    readonly size: number;
    readonly createdAt: number;
    readonly readAt: number | null;
  }
}
