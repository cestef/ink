import { describe, expect, test } from 'bun:test';
import { Submission } from '../src/store/submission.ts';
import { World } from './harness/world.ts';

/**
 * Submitting takes no credential, by design. These are the only bounds standing
 * between a forwarded link and an unbounded write, so they are worth pinning.
 */
describe('submission quota', () => {
  test('a full inbox refuses new submissions and names the bound', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'flood', title: 'bounded', passphrase: 'correct-horse-battery' });

    const body = new Uint8Array(64);
    for (let i = 0; i < Submission.QUOTA; i++) {
      expect((await owner.post(body)).status).toBe(201);
    }

    const refused = await owner.post(body);
    expect(refused.status).toBe(429);

    const diag = (await refused.json()) as { error: { code: string; help?: string[] } };
    expect(diag.error.code).toBe('submission.quota');
    expect(diag.error.help?.length).toBeGreaterThan(0);

    // The flood denies new writes, it does not destroy what is already held.
    const page = await owner.list();
    expect(page.length).toBe(Submission.PAGE);
  });

  test('the byte bound refuses before writing the blob', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'bytes', title: 'bounded', passphrase: 'correct-horse-battery' });

    const big = new Uint8Array(Submission.MAX);
    const rounds = Math.ceil(Submission.QUOTA_BYTES / Submission.MAX);

    let refusedAt = 0;
    for (let i = 0; i <= rounds; i++) {
      const response = await owner.post(big);
      if (response.status === 429) {
        refusedAt = i;
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe('submission.quota');
        break;
      }
      expect(response.status).toBe(201);
    }

    expect(refusedAt).toBeGreaterThan(0);
    expect(refusedAt * Submission.MAX).toBeLessThanOrEqual(Submission.QUOTA_BYTES + Submission.MAX);
  });

  test('one inbox filling up does not affect another', async () => {
    const world = await World.make();
    const full = await world.open({ slug: 'full-one', title: 'a', passphrase: 'correct-horse-battery' });
    const spare = await world.open({ slug: 'spare-one', title: 'b', passphrase: 'correct-horse-battery' });

    const body = new Uint8Array(64);
    for (let i = 0; i < Submission.QUOTA; i++) await full.post(body);

    expect((await full.post(body)).status).toBe(429);
    expect((await spare.post(body)).status).toBe(201);
  });
});
