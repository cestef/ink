import { Database } from 'bun:sqlite';
import * as age from 'age-encryption';
import { Blobs } from '../../src/blob/blobs.ts';
import { Key } from '../../src/core/key.ts';
import type { Route } from '../../src/core/route.ts';
import { Routes } from '../../src/core/routes.ts';
import { Local } from '../../src/host/local.ts';
import { Api } from '../../src/serve/api.ts';
import { App } from '../../src/serve/app.ts';
import { Site } from '../../src/serve/site.ts';
import { Tenant } from '../../src/serve/tenant.ts';
import { Db } from '../../src/store/db.ts';

/** A whole ink, in memory, driven through the same `fetch` a host would call. */
export class World {
  static readonly ORIGIN = 'https://ink.test';
  static readonly TOKEN = 'x-ink-token';

  /**
   * scrypt at the shipped work factor takes about a second per wrap, and these
   * tests wrap on nearly every case. The factor changes how long the KDF runs,
   * not the format or any code under test, so the suite turns it down and the
   * shipped path is left on age's default.  still opens real
   * archives with the real binary, at whatever factor they were written with.
   */
  static readonly SCRYPT = 10;

  private constructor(
    readonly app: App,
    readonly db: Db,
    readonly blobs: Blobs.Memory,
  ) {}

  static async make(domain: string | null = null): Promise<World> {
    const db = new Db(new Local.Sqlite(new Database(':memory:')));
    await db.migrate();
    const ctx = { db, blobs: new Blobs.Memory(), domain };
    return new World(Site.mount(Api.mount(new App(new Tenant(domain)), ctx), ctx), db, ctx.blobs);
  }

  /** Hits the app the way a browser on an inbox subdomain would. */
  at(slug: string, path: string, init: RequestInit = {}): Promise<Response> {
    return this.app.fetch(new Request(`https://${slug}.ink.test${path}`, init));
  }

  fetch<S extends string>(route: Route<S>, params: Route.Args<S>, init: RequestInit = {}): Promise<Response> {
    return this.app.fetch(new Request(new URL(route.path(params), World.ORIGIN), init));
  }

  /** Does the real client-side crypto, so tests exercise the shipped format. */
  async open(input: World.New): Promise<Owner> {
    const kind = Key.of(input.kind ?? Key.DEFAULT);
    const identity =
      kind === 'hybrid' ? await age.generateHybridIdentity() : await age.generateX25519Identity();
    const recipient = await age.identityToRecipient(identity);

    const encrypter = new age.Encrypter();
    encrypter.setPassphrase(input.passphrase);
    encrypter.setScryptWorkFactor(World.SCRYPT);
    const wrapped = age.armor.encode(await encrypter.encrypt(identity));

    const response = await this.fetch(Routes.api.create, undefined, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: input.slug,
        title: input.title,
        recipient,
        retain: input.retain ?? 'forever',
        burn: input.burn ?? false,
        fields: input.fields ?? [],
        wrappings: [{ kind: 'passphrase', label: 'passphrase', wrapped }],
      }),
    });
    if (response.status !== 201) throw new Error(`create failed: ${response.status}`);

    const body = (await response.json()) as { token: string };
    return new Owner(this, input.slug, body.token, identity, recipient);
  }
}

export namespace World {
  export interface New {
    readonly slug: string;
    readonly title: string;
    readonly passphrase: string;
    readonly kind?: Key.Kind;
    /** One of Retention.OPTIONS, defaulting to keeping everything. */
    readonly retain?: string;
    readonly burn?: boolean;
    readonly fields?: readonly {
      readonly label: string;
      readonly kind: string;
      readonly required?: boolean;
    }[];
  }
}

/** The receiving side: holds the identity, so it can read what strangers send. */
export class Owner {
  constructor(
    private readonly world: World,
    readonly slug: string,
    readonly token: string,
    readonly identity: string,
    readonly recipient: string,
  ) {}

  /** A stranger's submission: encrypts to the recipient, with no token. */
  async submit(text: string, recipient = this.recipient): Promise<Response> {
    const encrypter = new age.Encrypter();
    encrypter.addRecipient(recipient);
    return this.post(await encrypter.encrypt(text));
  }

  /** Bypasses encryption, to exercise the transport guards on their own. */
  post(body: Uint8Array): Promise<Response> {
    return this.world.fetch(
      Routes.api.submissions,
      { slug: this.slug },
      { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body },
    );
  }

  listed(token?: string): Promise<Response> {
    return this.world.fetch(Routes.api.submissions, { slug: this.slug }, this.auth(token));
  }

  keyed(token?: string): Promise<Response> {
    return this.world.fetch(Routes.api.key, { slug: this.slug }, this.auth(token));
  }

  async list(): Promise<Owner.View[]> {
    const response = await this.listed();
    const body = (await response.json()) as { submissions: Owner.View[] };
    return body.submissions;
  }

  async ciphertext(id: string): Promise<Uint8Array> {
    const response = await this.world.fetch(Routes.api.submission, { slug: this.slug, id }, this.auth());
    if (!response.ok) throw new Error(`read failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async read(id: string): Promise<string> {
    const decrypter = new age.Decrypter();
    decrypter.addIdentity(this.identity);
    return decrypter.decrypt(await this.ciphertext(id), 'text');
  }

  async wrappings(): Promise<Owner.Wrapping[]> {
    const response = await this.keyed();
    if (!response.ok) throw new Error(`key failed: ${response.status}`);
    const body = (await response.json()) as { wrappings: Owner.Wrapping[] };
    return body.wrappings;
  }

  /** Unwraps a stored wrapping exactly as the manage page does. */
  async unwrap(passphrase: string, at = 0): Promise<string> {
    const wrapping = (await this.wrappings())[at];
    if (!wrapping) throw new Error(`no wrapping at ${at}`);
    const decrypter = new age.Decrypter();
    decrypter.addPassphrase(passphrase);
    return decrypter.decrypt(age.armor.decode(wrapping.armored), 'text');
  }

  /** Seals the identity under a second passphrase, standing in for a device. */
  async enrol(passphrase: string, label = 'second'): Promise<Response> {
    const encrypter = new age.Encrypter();
    encrypter.setPassphrase(passphrase);
    encrypter.setScryptWorkFactor(World.SCRYPT);
    const wrapped = age.armor.encode(await encrypter.encrypt(this.identity));
    return this.world.fetch(
      Routes.api.key,
      { slug: this.slug },
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', [World.TOKEN]: this.token },
        body: JSON.stringify({ wrappings: [{ kind: 'passphrase', label, wrapped }] }),
      },
    );
  }

  /** Deletes one submission. */
  async discard(id: string): Promise<Response> {
    return this.world.fetch(
      Routes.api.submission,
      { slug: this.slug, id },
      { method: 'DELETE', headers: { [World.TOKEN]: this.token } },
    );
  }

  /** Deletes the whole inbox. */
  async destroy(): Promise<Response> {
    return this.world.fetch(
      Routes.api.inbox,
      { slug: this.slug },
      { method: 'DELETE', headers: { [World.TOKEN]: this.token } },
    );
  }

  /** Stops or resumes new submissions. */
  async close(closed: boolean): Promise<boolean> {
    const response = await this.world.fetch(
      Routes.api.state,
      { slug: this.slug },
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', [World.TOKEN]: this.token },
        body: JSON.stringify({ closed }),
      },
    );
    if (!response.ok) throw new Error(`close failed: ${response.status}`);
    return ((await response.json()) as { closed: boolean }).closed;
  }

  /** Mints a new manage token, invalidating this one. */
  async rotate(): Promise<string> {
    const response = await this.world.fetch(
      Routes.api.token,
      { slug: this.slug },
      { method: 'POST', headers: { [World.TOKEN]: this.token } },
    );
    if (!response.ok) throw new Error(`rotate failed: ${response.status}`);
    return ((await response.json()) as { token: string }).token;
  }

  async forget(id: string): Promise<Response> {
    return this.world.fetch(
      Routes.api.wrapping,
      { slug: this.slug, id },
      {
        method: 'DELETE',
        headers: { [World.TOKEN]: this.token },
      },
    );
  }

  /** An empty token means "send no header at all", which is a distinct refusal. */
  auth(token: string | undefined = this.token): RequestInit {
    return token ? { headers: { [World.TOKEN]: token } } : {};
  }
}

export namespace Owner {
  export interface Wrapping {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
    readonly credential: string | null;
    readonly armored: string;
    readonly createdAt: number;
  }

  export interface View {
    readonly id: string;
    readonly size: number;
    readonly createdAt: number;
    readonly readAt: number | null;
  }
}
