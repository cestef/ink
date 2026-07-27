import { Database } from 'bun:sqlite';
import * as age from 'age-encryption';
import { Blobs } from '../src/blob/blobs.ts';
import { Code, Diag, Span } from '../src/core/diag/index.ts';
import { Routes } from '../src/core/routes.ts';
import { Slug } from '../src/core/slug.ts';
import { Local } from '../src/host/local.ts';
import { Api } from '../src/serve/api.ts';
import { App } from '../src/serve/app.ts';
import { Site } from '../src/serve/site.ts';
import { Db } from '../src/store/db.ts';
import { Inbox } from '../src/store/inbox.ts';
import { Submission } from '../src/store/submission.ts';
import { Bench } from './harness.ts';

const ORIGIN = 'https://ink.bench';

const db = new Db(new Local.Sqlite(new Database(':memory:')));
await db.migrate();
const blobs = new Blobs.Memory();
const ctx = { db, blobs };
const app = Site.mount(Api.mount(new App(), ctx), ctx);

const identity = await age.generateX25519Identity();
const recipient = await age.identityToRecipient(identity);

const wrapper = new age.Encrypter();
wrapper.setPassphrase('correct-horse-battery-staple');
const wrapped = age.armor.encode(await wrapper.encrypt(identity));

const created = await app.fetch(
  new Request(new URL(Routes.api.create.path(), ORIGIN), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'bench', title: 'benchmarks', recipient, wrapped }),
  }),
);
const { token } = (await created.json()) as { token: string };

const encrypter = new age.Encrypter();
encrypter.addRecipient(recipient);
const ciphertext = new Uint8Array(await encrypter.encrypt('hunter2'));

const slug = Slug.parse('bench');
const inbox = await Inbox.bySlug(db, slug);
const diag = Diag.of(Code.SLUG_INVALID, 'address must be lowercase letters, digits and hyphens')
  .withSource('acmE', Span.at('acmE', 3, 'not allowed here'))
  .withHelp('a hyphen may sit between characters, never at either end');

const bench = new Bench();

await bench.measure('route.path', () => Routes.api.submission.path({ slug: 'bench', id: 'abc' }), 20_000);
await bench.measure('diag.render', () => diag.render(), 20_000);
await bench.measure('page.render (home)', () => app.fetch(new Request(new URL('/', ORIGIN))), 2_000);
await bench.measure('page.render (inbox)', () => app.fetch(new Request(new URL('/i/bench', ORIGIN))), 2_000);
await bench.measure('store.inbox lookup', () => Inbox.bySlug(db, slug), 5_000);
await bench.measure('store.submission accept', () => Submission.accept(db, blobs, inbox, ciphertext), 2_000);
await bench.measure('age.encrypt (browser path)', () => encrypter.encrypt('hunter2'), 500);

await bench.measure(
  'POST submission (end to end)',
  () =>
    app.fetch(
      new Request(new URL(Routes.api.submissions.path({ slug: 'bench' }), ORIGIN), {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: ciphertext,
      }),
    ),
  1_000,
);

await bench.measure(
  'GET submissions (end to end)',
  () =>
    app.fetch(
      new Request(new URL(Routes.api.submissions.path({ slug: 'bench' }), ORIGIN), {
        headers: { 'x-ink-token': token },
      }),
    ),
  200,
);

bench.report();
