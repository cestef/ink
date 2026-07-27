import { describe, expect, test } from 'bun:test';
import { Archive } from '../src/core/archive.ts';
import { Tar } from '../src/core/tar.ts';

const at = new Date('2026-07-27T22:14:58.123Z');
const bytes = (text: string) => new TextEncoder().encode(text);
const read = (archive: Uint8Array, name: string) =>
  new TextDecoder().decode(Tar.unpack(archive).find((entry) => entry.name === name)?.bytes);

describe('export archive', () => {
  const items = [
    { id: 'aa11', createdAt: Date.parse('2026-07-27T10:00:00Z'), bytes: bytes('first sealed') },
    { id: 'bb22', createdAt: Date.parse('2026-07-26T09:30:00Z'), bytes: bytes('second sealed') },
  ];

  test('carries every submission plus a readme', () => {
    const names = Tar.unpack(Archive.pack('acme', items, at)).map((entry) => entry.name);
    expect(names).toEqual([
      'README.txt',
      '001-2026-07-27T10-00-00Z-aa11.age',
      '002-2026-07-26T09-30-00Z-bb22.age',
    ]);
  });

  test('the ciphertext is passed through untouched', () => {
    const archive = Archive.pack('acme', items, at);
    expect(read(archive, '001-2026-07-27T10-00-00Z-aa11.age')).toBe('first sealed');
    expect(read(archive, '002-2026-07-26T09-30-00Z-bb22.age')).toBe('second sealed');
  });

  /** An archive nobody can open is not an export. */
  test('the readme says how to open it and what the key is', () => {
    const readme = read(Archive.pack('acme', items, at), Archive.README);
    expect(readme).toContain('age -d -i identity.txt');
    expect(readme).toContain('tar -x');
    expect(readme).toContain('identity.txt is the key file');
    expect(readme).toContain('2 submission(s)');
    expect(readme).toContain('"acme"');
  });

  test('an empty inbox still exports something explicable', () => {
    const archive = Archive.pack('acme', [], at);
    expect(Tar.unpack(archive).map((entry) => entry.name)).toEqual(['README.txt']);
    expect(read(archive, Archive.README)).toContain('0 submission(s)');
  });

  test('filenames are sortable and free of characters filesystems dislike', () => {
    const names = Tar.unpack(Archive.pack('acme', items, at)).map((entry) => entry.name);
    for (const name of names) expect(name).not.toMatch(/[:\\\\?*"<>|]/);
    expect(Archive.name('acme', at)).toBe('acme-2026-07-27T22-14-58Z.tar');
  });

  test('order is preserved, so the newest stays first', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `id${index}`,
      createdAt: at.getTime() - index * 1000,
      bytes: bytes(`body ${index}`),
    }));
    const names = Tar.unpack(Archive.pack('acme', many, at))
      .map((entry) => entry.name)
      .filter((name) => name !== Archive.README);

    expect(names[0]).toContain('001-');
    expect(names[11]).toContain('012-');
    // Zero padded, so a plain sort matches the order the inbox listed them.
    expect([...names].sort()).toEqual(names);
  });
});
