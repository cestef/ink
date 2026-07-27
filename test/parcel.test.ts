import { describe, expect, test } from 'bun:test';
import { Code, Diag } from '../src/core/diag/index.ts';
import { Field } from '../src/core/field.ts';
import { Routes } from '../src/core/routes.ts';
import { Tar } from '../src/core/tar.ts';
import { World } from './harness/world.ts';

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('tar', () => {
  test('round trips names, sizes and bytes', () => {
    const entries = [
      { name: '01-aws-key.txt', bytes: enc('AKIAIOSFODNN7EXAMPLE') },
      { name: '02-notes.txt', bytes: enc('line one\nline two\n') },
      { name: '03-invoice-report.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    ];

    const back = Tar.unpack(Tar.pack(entries));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    expect(back.map((e) => dec(e.bytes))).toEqual(entries.map((e) => dec(e.bytes)));
  });

  test('every archive is a whole number of blocks and ends with two zero ones', () => {
    const archive = Tar.pack([{ name: 'a.txt', bytes: enc('x') }]);
    expect(archive.length % Tar.BLOCK).toBe(0);
    expect(archive.subarray(-Tar.BLOCK * 2).every((byte) => byte === 0)).toBe(true);
  });

  test('content that lands exactly on a block boundary is not mangled', () => {
    for (const size of [0, 1, 511, 512, 513, 1024]) {
      const bytes = new Uint8Array(size).fill(0x41);
      const [back] = Tar.unpack(Tar.pack([{ name: 'pad.bin', bytes }]));
      expect({ size, length: back?.bytes.length }).toEqual({ size, length: size });
    }
  });

  test('binary survives, including NUL bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 0, 255]);
    const [back] = Tar.unpack(Tar.pack([{ name: 'raw.bin', bytes }]));
    expect([...(back?.bytes ?? [])]).toEqual([...bytes]);
  });

  test('the header carries a ustar magic and a valid checksum', () => {
    const archive = Tar.pack([{ name: 'a.txt', bytes: enc('hello') }]);
    expect(dec(archive.subarray(257, 263))).toBe(Tar.MAGIC);

    const header = archive.subarray(0, Tar.BLOCK);
    const stated = Number.parseInt(dec(header.subarray(148, 154)), 8);

    const recomputed = header.reduce((sum, byte, at) => sum + (at >= 148 && at < 156 ? 0x20 : byte), 0);
    expect(stated).toBe(recomputed);
  });

  test('a name too long for ustar is a diagnostic, not a corrupt archive', () => {
    const name = `${'x'.repeat(Tar.NAME_MAX + 1)}.txt`;
    let raised: Diag | null = null;
    try {
      Tar.pack([{ name, bytes: enc('x') }]);
    } catch (cause) {
      raised = cause as Diag;
    }
    expect(raised).toBeInstanceOf(Diag);
    expect(raised?.code).toBe(Code.TAR_NAME);
  });
});

describe('fields', () => {
  test('a key is derived from the label and prefixed by position', () => {
    const fields = Field.all([
      { label: 'AWS access key', kind: 'secret' },
      { label: 'Database URL', kind: 'text' },
    ]);
    expect(fields.map((field) => field.key)).toEqual(['01-aws-access-key', '02-database-url']);
  });

  test('two fields sharing a label still land in two files', () => {
    const fields = Field.all([
      { label: 'Password', kind: 'secret' },
      { label: 'Password', kind: 'secret' },
    ]);
    expect(new Set(fields.map((field) => field.key)).size).toBe(2);
  });

  test('a label of punctuation still yields a usable key', () => {
    expect(Field.all([{ label: '!!! ???', kind: 'text' }])[0]?.key).toBe('01-field');
  });

  test('no fields is a valid inbox, and means one free-text box', () => {
    expect(Field.all(undefined)).toEqual([]);
    expect(Field.all([])).toEqual([]);
  });

  test('a form nobody would finish is refused', () => {
    const many = Array.from({ length: Field.MAX + 1 }, (_, at) => ({ label: `f${at}`, kind: 'text' }));
    expect(() => Field.all(many)).toThrow(Diag);
  });

  test('an unlabelled or unknown field is refused', () => {
    expect(() => Field.all([{ kind: 'text' }])).toThrow(Diag);
    expect(() => Field.all([{ label: 'x', kind: 'hologram' }])).toThrow(Diag);
  });

  test('every declared kind parses', () => {
    for (const option of Field.KINDS) {
      expect(Field.all([{ label: 'x', kind: option.kind }])[0]?.kind).toBe(option.kind);
    }
  });
});

describe('an inbox that asks for several things', () => {
  test('renders a control per field, and no free-text box', async () => {
    const world = await World.make();
    const owner = await world.open({
      slug: 'onboarding',
      title: 'Client onboarding',
      passphrase: 'correct-horse-battery',
      fields: [
        { label: 'AWS access key', kind: 'secret', required: true },
        { label: 'Notes', kind: 'multiline' },
        { label: 'Signed contract', kind: 'file' },
      ],
    });

    const html = await (await world.fetch(Routes.page.inbox, { slug: owner.slug })).text();

    expect(html).toContain('id="f-01-aws-access-key" type="password"');
    expect(html).toContain('AWS access key (required)');
    expect(html).toContain('<textarea id="f-02-notes"');
    expect(html).toContain('id="f-03-signed-contract" type="file"');
    // The single free-text box belongs to inboxes that ask for nothing.
    expect(html).not.toContain('id="secret"');
  });

  test('an inbox with no fields still gets the single box', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'plain', title: 'Plain', passphrase: 'correct-horse-battery' });

    const html = await (await world.fetch(Routes.page.inbox, { slug: owner.slug })).text();
    expect(html).toContain('id="secret"');
    expect(html).toContain('data-fields="[]"');
  });

  test('labels reach the page but nothing about them is secret', async () => {
    const world = await World.make();
    const owner = await world.open({
      slug: 'labelled',
      title: 'T',
      passphrase: 'correct-horse-battery',
      fields: [{ label: 'Registrar login', kind: 'text' }],
    });

    // Stated plainly in the docs: ink hides what people send, not what you ask.
    const html = await (await world.fetch(Routes.page.inbox, { slug: owner.slug })).text();
    expect(html).toContain('Registrar login');
  });

  test('a form too long to finish is refused at creation', async () => {
    const world = await World.make();
    await expect(
      world.open({
        slug: 'toomany',
        title: 'T',
        passphrase: 'correct-horse-battery',
        fields: Array.from({ length: Field.MAX + 1 }, (_, at) => ({ label: `Field ${at}`, kind: 'text' })),
      }),
    ).rejects.toThrow();
  });
});
