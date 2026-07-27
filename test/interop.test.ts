import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Key } from '../src/core/key.ts';
import { Recipient } from '../src/core/recipient.ts';
import { Tar } from '../src/core/tar.ts';
import { World } from './harness/world.ts';

/**
 * The wedge, tested for real: what ink stores must open with the stock `age`
 * CLI and nothing else. If this fails, the product is just another pastebin
 * with a proprietary blob format.
 */
const age = Bun.which('age') ?? `${process.env.HOME}/go/bin/age`;
const keygen = Bun.which('age-keygen') ?? `${process.env.HOME}/go/bin/age-keygen`;
const present = await Bun.file(age)
  .exists()
  .catch(() => false);

const home = await mkdtemp(`${tmpdir()}/ink-interop-`);
afterAll(() => rm(home, { recursive: true, force: true }));

class Cli {
  static async decrypt(identity: string, ciphertext: Uint8Array): Promise<string> {
    const key = `${home}/identity.txt`;
    await writeFile(key, `${identity}\n`);

    const proc = Bun.spawn([age, '--decrypt', '--identity', key], {
      stdin: ciphertext,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`age exited ${code}: ${err}`);
    return out;
  }

  /** Writes the identity where the shell pipelines below can reach it. */
  static async key(identity: string): Promise<string> {
    const path = `${home}/identity.txt`;
    await writeFile(
      path,
      `${identity}
`,
    );
    return path;
  }

  static async keygen(quantum: boolean): Promise<string> {
    const args = quantum ? [keygen, '-pq'] : [keygen];
    const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'ignore' });
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const line = out.split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'));
    if (!line) throw new Error('age-keygen produced no identity');
    return line.trim();
  }

  static async recipient(identity: string): Promise<string> {
    const file = `${home}/keygen.txt`;
    await writeFile(file, `${identity}\n`);
    const proc = Bun.spawn([keygen, '-y', file], { stdout: 'pipe', stderr: 'ignore' });
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return out.trim();
  }

  /** Runs a command and fails loudly, so a broken pipeline is not a silent pass. */
  static async run(args: string[]): Promise<void> {
    const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
    const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`${args.join(' ')} exited ${code}: ${err}`);
  }

  /** Encrypts arbitrary bytes, not just text, so a tar can go through. */
  static async seal(recipient: string, bytes: Uint8Array): Promise<Uint8Array> {
    const proc = Bun.spawn([age, '--encrypt', '--recipient', recipient], {
      stdin: bytes,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited]);
    if (code !== 0) throw new Error(`age exited ${code}`);
    return new Uint8Array(out);
  }

  static async encrypt(recipient: string, plaintext: string): Promise<Uint8Array> {
    const proc = Bun.spawn([age, '--encrypt', '--recipient', recipient], {
      stdin: new TextEncoder().encode(plaintext),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited]);
    if (code !== 0) throw new Error(`age exited ${code}`);
    return new Uint8Array(out);
  }
}

describe.skipIf(!present)('interop with the stock age CLI', () => {
  /**
   * Both native kinds, both directions. The post-quantum hybrid is not a
   * special case here: `age-keygen -pq` produces it and `age` opens it, which
   * is the whole reason ink accepts it.
   */
  for (const option of Key.OPTIONS) {
    test(`${option.kind}: what a stranger sent opens with age -d -i`, async () => {
      const world = await World.make();
      const owner = await world.open({
        slug: `interop-${option.kind}`,
        title: 'cli',
        passphrase: 'correct-horse-battery',
        kind: option.kind,
      });

      expect(Recipient.parse(owner.recipient).kind).toBe(option.kind);
      expect((await owner.submit('hunter2')).status).toBe(201);

      const [view] = await owner.list();
      expect(view).toBeDefined();

      const stored = await owner.ciphertext(view!.id);
      expect(await Cli.decrypt(owner.identity, stored)).toBe('hunter2');
    });

    test(`${option.kind}: what the CLI encrypts is accepted and reads back unchanged`, async () => {
      const world = await World.make();
      const owner = await world.open({
        slug: `reverse-${option.kind}`,
        title: 'cli',
        passphrase: 'correct-horse-battery',
        kind: option.kind,
      });

      const ciphertext = await Cli.encrypt(owner.recipient, 'from the terminal');
      expect((await owner.post(ciphertext)).status).toBe(201);

      const [view] = await owner.list();
      expect(await owner.read(view!.id)).toBe('from the terminal');
    });
  }

  /**
   * The whole point of packing a tar rather than a JSON envelope: a form with a
   * file attached comes back as files on disk, with `age` and `tar` and nothing
   * else. If this breaks, multi-field submissions are only readable by us.
   */
  test('a multi-field submission extracts with age and tar alone', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'formfill', title: 'Onboarding', passphrase: 'correct-horse-b' });

    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00, 0xff]);
    const parcel = Tar.pack([
      { name: '01-aws-access-key.txt', bytes: new TextEncoder().encode('AKIAIOSFODNN7EXAMPLE') },
      { name: '02-database-url.txt', bytes: new TextEncoder().encode('postgres://u:p@db/app') },
      { name: '03-contract-signed.pdf', bytes: pdf },
    ]);

    expect((await owner.post(await Cli.seal(owner.recipient, parcel))).status).toBe(201);

    const [view] = await owner.list();
    const stored = await owner.ciphertext(view!.id);

    // age to plaintext, tar to files, both the real binaries.
    const key = await Cli.key(owner.identity);
    const dir = `${home}/extract`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${home}/got.age`, stored);
    await Cli.run(['sh', '-c', `${age} -d -i ${key} < ${home}/got.age | tar -x -C ${dir}`]);

    expect((await readdir(dir)).sort()).toEqual([
      '01-aws-access-key.txt',
      '02-database-url.txt',
      '03-contract-signed.pdf',
    ]);
    expect(await Bun.file(`${dir}/01-aws-access-key.txt`).text()).toBe('AKIAIOSFODNN7EXAMPLE');
    expect([...new Uint8Array(await Bun.file(`${dir}/03-contract-signed.pdf`).arrayBuffer())]).toEqual([
      ...pdf,
    ]);
  });

  test('what the CLI tars, ink unpacks', async () => {
    await writeFile(`${home}/note.txt`, 'from the terminal');
    await Cli.run(['tar', '-cf', `${home}/theirs.tar`, '-C', home, 'note.txt']);

    const archive = new Uint8Array(await Bun.file(`${home}/theirs.tar`).arrayBuffer());
    const [entry] = Tar.unpack(archive);

    expect(entry?.name).toBe('note.txt');
    expect(new TextDecoder().decode(entry?.bytes)).toBe('from the terminal');
  });

  /**
   * bin/ink tars a directory rather than a list of names, which is how a sender
   * adds files the script was never told about. GNU tar then writes a `./`
   * member first, and that reached the manage page as an extra empty field with
   * a Save link that saved nothing.
   */
  test('a directory tarred whole unpacks to its files and nothing else', async () => {
    const box = `${home}/box`;
    await mkdir(box, { recursive: true });
    await writeFile(`${box}/secret.txt`, 'hunter2');
    await writeFile(`${box}/notes.txt`, 'rotate quarterly');
    await Cli.run(['tar', '-b', '1', '-cf', `${home}/whole.tar`, '-C', box, '.']);

    const entries = Tar.unpack(new Uint8Array(await Bun.file(`${home}/whole.tar`).arrayBuffer()));

    expect(entries.map((one) => one.name).sort()).toEqual(['notes.txt', 'secret.txt']);
    const secret = entries.find((one) => one.name === 'secret.txt');
    expect(new TextDecoder().decode(secret?.bytes)).toBe('hunter2');
  });

  test('a key born in age-keygen -pq is one ink accepts', async () => {
    const identity = await Cli.keygen(true);
    const recipient = await Cli.recipient(identity);
    expect(Recipient.parse(recipient).kind).toBe('hybrid');
    expect(identity.startsWith('AGE-SECRET-KEY-PQ-')).toBe(true);
  });

  test('the armored identity the browser stores is a real age file', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'wrapped', title: 'cli', passphrase: 'correct-horse-battery' });

    // The passphrase path cannot be driven headlessly: age reads it from a TTY.
    // What is checked here is that unwrapping yields the identity age accepts.
    const identity = await owner.unwrap('correct-horse-battery');
    expect(identity).toBe(owner.identity);

    const ciphertext = await Cli.encrypt(owner.recipient, 'round trip');
    expect(await Cli.decrypt(identity, ciphertext)).toBe('round trip');
  });
});
