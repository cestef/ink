import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import * as age from 'age-encryption';
import { Routes } from '../src/core/routes.ts';
import { Local } from '../src/host/local.ts';
import { Column } from '../src/store/column.ts';
import { Db } from '../src/store/db.ts';
import { Table } from '../src/store/table.ts';
import { Wrapping } from '../src/store/wrapping.ts';
import { World } from './harness/world.ts';

/**
 * The envelope, tested through passphrase wrappings. WebAuthn needs a real
 * authenticator and a user gesture, so the passkey adapter itself is verified
 * in a browser; what is pinned here is the structure it relies on: many
 * wrappings of one identity, any of which opens it.
 */
describe('unlock methods', () => {
  test('a second method opens the same identity as the first', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'envelope', title: 't', passphrase: 'correct-horse-battery' });

    expect((await owner.enrol('second-passphrase-here')).status).toBe(201);

    const wrappings = await owner.wrappings();
    expect(wrappings.length).toBe(2);
    expect(wrappings.map((w) => w.label)).toEqual(['passphrase', 'second']);

    // Different ciphertexts, same key underneath. That is the whole point.
    expect(wrappings[0]!.armored).not.toBe(wrappings[1]!.armored);
    expect(await owner.unwrap('correct-horse-battery', 0)).toBe(owner.identity);
    expect(await owner.unwrap('second-passphrase-here', 1)).toBe(owner.identity);
  });

  test('losing one method leaves the others working', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'forgetting', title: 't', passphrase: 'correct-horse-battery' });
    await owner.enrol('second-passphrase-here');

    const [first] = await owner.wrappings();
    expect((await owner.forget(first!.id)).status).toBe(204);

    const left = await owner.wrappings();
    expect(left.length).toBe(1);
    expect(await owner.unwrap('second-passphrase-here')).toBe(owner.identity);
  });

  test('the last method cannot be removed', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'lastone', title: 't', passphrase: 'correct-horse-battery' });

    const [only] = await owner.wrappings();
    const refused = await owner.forget(only!.id);
    expect(refused.status).toBe(400);

    const body = (await refused.json()) as { error: { code: string; help?: string[] } };
    expect(body.error.code).toBe('wrapping.none');
    expect(body.error.help?.[0]).toContain('add another');

    // And it really is still there.
    expect((await owner.wrappings()).length).toBe(1);
  });

  test('an inbox cannot be created with no way in', async () => {
    const world = await World.make();
    const response = await world.fetch(Routes.api.create, undefined, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'keyless',
        title: 't',
        recipient: await age.identityToRecipient(await age.generateX25519Identity()),
        wrappings: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('wrapping.none');
  });

  test('unknown unlock kinds are refused', async () => {
    const world = await World.make();
    const response = await world.fetch(Routes.api.create, undefined, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'bogus',
        title: 't',
        recipient: await age.identityToRecipient(await age.generateX25519Identity()),
        wrappings: [{ kind: 'fingerprint', label: 'x', wrapped: 'nope' }],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; help?: string[] } };
    expect(body.error.code).toBe('wrapping.invalid');
    expect(body.error.help?.[0]).toContain('passkey');
  });

  test('methods are capped', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'crowded', title: 't', passphrase: 'correct-horse-battery' });

    for (let i = 1; i < Wrapping.MAX; i++) {
      expect((await owner.enrol(`passphrase-number-${i}`, `device-${i}`)).status).toBe(201);
    }

    const refused = await owner.enrol('one-too-many-here', 'overflow');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('wrapping.many');
  });
});

/**
 * The schema moved the wrapping off `inbox`, and an existing row's key had to
 * survive that. If it did not, every inbox created before the change is dead.
 */
describe('migration to unlock methods', () => {
  /** The `inbox` table as it stood before wrappings moved to their own table. */
  const legacy = new Table('inbox', {
    id: Column.text(),
    slug: Column.text(),
    title: Column.text(),
    recipient: Column.text(),
    wrappedIdentity: Column.text(),
    manageTokenHash: Column.text(),
    createdAt: Column.int(),
  });

  test('an inbox written under the old schema keeps its key', async () => {
    const db = new Db(new Local.Sqlite(new Database(':memory:')));

    // Stop after the first migration, then write a row the way it used to be.
    await db.driver.run(Db.LEDGER_DDL);
    for (const statement of Db.MIGRATIONS[0]!.sql) await db.driver.run(statement);
    await Db.LEDGER.insert(db, { n: 1, name: Db.MIGRATIONS[0]!.name });

    const identity = await age.generateX25519Identity();
    const encrypter = new age.Encrypter();
    encrypter.setPassphrase('correct-horse-battery');
    encrypter.setScryptWorkFactor(World.SCRYPT);

    await legacy.insert(db, {
      id: 'old1',
      slug: 'legacy',
      title: 't',
      recipient: await age.identityToRecipient(identity),
      wrappedIdentity: age.armor.encode(await encrypter.encrypt(identity)),
      manageTokenHash: 'hash',
      createdAt: 1,
    });

    await db.migrate();
    expect((await db.applied()).map((row) => row.name)).toEqual(Db.MIGRATIONS.map((m) => m.name));

    const rows = await Wrapping.TABLE.select(db).where({ inboxId: 'old1' }).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind).toBe('passphrase');
    expect(rows[0]!.createdAt).toBe(1);

    const decrypter = new age.Decrypter();
    decrypter.addPassphrase('correct-horse-battery');
    expect(await decrypter.decrypt(age.armor.decode(rows[0]!.armored), 'text')).toBe(identity);

    // The old column is gone, so there is one home for the key, not two.
    expect(await db.columns('inbox')).not.toContain('wrapped_identity');
  });
});
