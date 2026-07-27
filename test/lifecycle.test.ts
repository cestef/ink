import { describe, expect, test } from 'bun:test';
import { Retention } from '../src/core/retention.ts';
import { Routes } from '../src/core/routes.ts';
import { Submission } from '../src/store/submission.ts';
import { Wrapping } from '../src/store/wrapping.ts';
import { World } from './harness/world.ts';

const PASS = 'correct-horse-battery';

describe('deleting a submission', () => {
  test('removes the row and the ciphertext, and leaves the rest alone', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'discard', title: 't', passphrase: PASS });

    await owner.submit('first');
    await owner.submit('second');

    const before = await owner.list();
    expect(before.length).toBe(2);

    expect((await owner.discard(before[0]!.id)).status).toBe(204);

    const after = await owner.list();
    expect(after.length).toBe(1);
    expect(after[0]!.id).toBe(before[1]!.id);

    // The bytes are gone, not merely unlisted.
    expect(world.blobs.size).toBe(1);
    expect((await owner.discard(before[0]!.id)).status).toBe(404);

    // What is left still opens.
    expect(await owner.read(after[0]!.id)).toBe('first');
  });

  test('deleting needs the manage token', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'guarded-del', title: 't', passphrase: PASS });
    await owner.submit('secret');

    const [view] = await owner.list();
    const response = await world.fetch(
      Routes.api.submission,
      { slug: owner.slug, id: view!.id },
      { method: 'DELETE' },
    );

    expect(response.status).toBe(403);
    expect((await owner.list()).length).toBe(1);
  });
});

describe('deleting an inbox', () => {
  test('takes its submissions, its ciphertext and its keys with it', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'closing', title: 't', passphrase: PASS });
    await owner.submit('one');
    await owner.submit('two');

    const response = await owner.destroy();
    expect(response.status).toBe(200);
    expect(((await response.json()) as { deleted: number }).deleted).toBe(2);

    expect(world.blobs.size).toBe(0);
    expect((await Wrapping.TABLE.select(world.db).where({ inboxId: 'x' }).all()).length).toBe(0);
    expect((await Submission.TABLE.select(world.db).all()).length).toBe(0);

    // The address is free again, and the page is gone.
    expect((await world.fetch(Routes.page.inbox, { slug: 'closing' })).status).toBe(404);
    const remade = await world.open({ slug: 'closing', title: 'new', passphrase: PASS });
    expect(remade.slug).toBe('closing');
  });

  test('deleting needs the manage token', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'guarded-inbox', title: 't', passphrase: PASS });

    const response = await world.fetch(Routes.api.inbox, { slug: owner.slug }, { method: 'DELETE' });
    expect(response.status).toBe(403);
    expect((await world.fetch(Routes.page.inbox, { slug: owner.slug })).status).toBe(200);
  });
});

describe('retention', () => {
  test('an expired submission is unreadable even before any sweep runs', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'lapsing', title: 't', passphrase: PASS, retain: 'hour' });

    await owner.submit('stale');
    const [view] = await owner.list();

    // Backdate it past the window rather than waiting an hour.
    await Submission.TABLE.select(world.db)
      .where({ id: view!.id })
      .update({ createdAt: Date.now() - Retention.HOUR - 1000 });

    expect((await owner.list()).length).toBe(0);

    const refused = await world.fetch(
      Routes.api.submission,
      { slug: owner.slug, id: view!.id },
      owner.auth(),
    );
    expect(refused.status).toBe(410);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('submission.expired');
  });

  test('the next write sweeps what has lapsed, so it stops costing quota', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'sweeping', title: 't', passphrase: PASS, retain: 'hour' });

    await owner.submit('old');
    const [view] = await owner.list();
    await Submission.TABLE.select(world.db)
      .where({ id: view!.id })
      .update({ createdAt: Date.now() - Retention.HOUR - 1000 });

    expect(world.blobs.size).toBe(1);
    await owner.submit('fresh');

    // The lapsed one is gone from storage, not just hidden from the listing.
    expect(world.blobs.size).toBe(1);
    const left = await owner.list();
    expect(left.length).toBe(1);
    expect(await owner.read(left[0]!.id)).toBe('fresh');
  });

  test('keeping forever keeps forever', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'forever', title: 't', passphrase: PASS, retain: 'forever' });

    await owner.submit('kept');
    const [view] = await owner.list();
    await Submission.TABLE.select(world.db).where({ id: view!.id }).update({ createdAt: 0 });

    expect((await owner.list()).length).toBe(1);
    expect(await owner.read(view!.id)).toBe('kept');
  });

  test('an unknown retention period is refused', async () => {
    const world = await World.make();
    await expect(
      world.open({ slug: 'bogus-retain', title: 't', passphrase: PASS, retain: 'decade' }),
    ).rejects.toThrow();
  });
});

describe('burn after reading', () => {
  test('reading destroys it, and only after the bytes are in hand', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'burning', title: 't', passphrase: PASS, burn: true });

    await owner.submit('once only');
    const [view] = await owner.list();

    expect(await owner.read(view!.id)).toBe('once only');

    expect(world.blobs.size).toBe(0);
    expect((await owner.list()).length).toBe(0);
  });

  test('without burn, reading only marks it read', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'keeping', title: 't', passphrase: PASS });

    await owner.submit('twice');
    const [view] = await owner.list();

    expect(await owner.read(view!.id)).toBe('twice');
    expect(await owner.read(view!.id)).toBe('twice');
    expect((await owner.list())[0]!.readAt).not.toBeNull();
  });
});

describe('closing an inbox', () => {
  test('stops new submissions and keeps everything already held', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'shutting', title: 't', passphrase: PASS });
    await owner.submit('before');

    expect(await owner.close(true)).toBe(true);

    const refused = await owner.submit('after');
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string; help?: string[] } };
    expect(body.error.code).toBe('inbox.closed');
    expect(body.error.help?.length).toBeGreaterThan(0);

    // What was already sent is untouched and still readable.
    const held = await owner.list();
    expect(held.length).toBe(1);
    expect(await owner.read(held[0]!.id)).toBe('before');
  });

  test('the submit page says so instead of offering a form', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'shutpage', title: 'Client keys', passphrase: PASS });
    await owner.close(true);

    const page = await world.fetch(Routes.page.inbox, { slug: owner.slug });
    const html = await page.text();

    expect(page.status).toBe(200);
    expect(html).toContain('closed');
    expect(html).not.toContain('id="secret"');
  });

  test('reopening takes it back', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'reopening', title: 't', passphrase: PASS });

    await owner.close(true);
    expect((await owner.submit('nope')).status).toBe(409);

    expect(await owner.close(false)).toBe(false);
    expect((await owner.submit('yes')).status).toBe(201);
  });

  test('closing needs the manage token', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'noclose', title: 't', passphrase: PASS });

    const response = await world.fetch(
      Routes.api.state,
      { slug: owner.slug },
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ closed: true }),
      },
    );
    expect(response.status).toBe(403);
    expect((await owner.submit('still open')).status).toBe(201);
  });
});

describe('rotating the manage token', () => {
  test('the new token works and the old one stops', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'rotating', title: 't', passphrase: PASS });
    await owner.submit('secret');

    const old = owner.token;
    const fresh = await owner.rotate();
    expect(fresh).not.toBe(old);

    expect((await owner.listed(old)).status).toBe(403);
    expect((await owner.listed(fresh)).status).toBe(200);

    // The key itself is untouched, so what was sent still opens.
    const body = (await (await owner.listed(fresh)).json()) as { submissions: { id: string }[] };
    expect(body.submissions.length).toBe(1);
  });

  test('rotating needs the token it is replacing', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'norotate', title: 't', passphrase: PASS });

    const response = await world.fetch(Routes.api.token, { slug: owner.slug }, { method: 'POST' });
    expect(response.status).toBe(403);
    expect((await owner.listed()).status).toBe(200);
  });
});
