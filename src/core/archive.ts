import { Tar } from './tar.ts';

/**
 * Everything an inbox holds, as one tar of age files.
 *
 * Exported sealed rather than decrypted, and that is the point: the archive is
 * the same bytes the server held, so it needs neither ink nor this browser to
 * open later. Writing plaintext to somebody's downloads folder would undo the
 * only thing the product does.
 *
 * The README travels with it because an archive whose format you have to
 * remember is an archive you will not open in two years.
 */
export class Archive {
  static readonly README = 'README.txt';
  static readonly EXT = '.age';

  static name(slug: string, at: Date): string {
    return `${slug}-${Archive.stamp(at)}.tar`;
  }

  /** Sortable, and legal on every filesystem: no colons. */
  private static stamp(at: Date): string {
    return at
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace(/-\d{3}Z$/, 'Z');
  }

  static pack(slug: string, items: readonly Archive.Item[], at: Date): Uint8Array {
    const entries: Tar.Entry[] = items.map((item, index) => ({
      name: Archive.entry(index, item),
      bytes: item.bytes,
    }));

    entries.unshift({
      name: Archive.README,
      bytes: new TextEncoder().encode(Archive.readme(slug, entries.length, at)),
    });

    return Tar.pack(entries);
  }

  /** Numbered so the archive lists in the order the inbox did, newest first. */
  private static entry(index: number, item: Archive.Item): string {
    const when = Archive.stamp(new Date(item.createdAt));
    return `${String(index + 1).padStart(3, '0')}-${when}-${item.id}${Archive.EXT}`;
  }

  private static readme(slug: string, count: number, at: Date): string {
    return [
      `${count} submission(s) from the ink inbox "${slug}".`,
      `Exported ${at.toISOString()}.`,
      '',
      'Every .age file here is exactly what the server held, and the server could',
      'not read any of it. They are unchanged, so they open with the stock age',
      'CLI on any machine, with or without ink:',
      '',
      '    age -d -i identity.txt 001-....age | tar -x',
      '',
      'Each one decrypts to a tar of the fields that were submitted. A submission',
      'to an inbox that asked for nothing in particular contains a single',
      'secret.txt.',
      '',
      'identity.txt is the key file you saved when you created the inbox. Without',
      'it nothing here can be opened, by anyone, including whoever wrote this.',
      '',
      'age: https://age-encryption.org',
      '',
    ].join('\n');
  }
}

export namespace Archive {
  export interface Item {
    readonly id: string;
    readonly createdAt: number;
    readonly bytes: Uint8Array;
  }
}
