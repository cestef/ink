import type { Field } from '../core/field.ts';
import { Tar } from '../core/tar.ts';
import { Fault } from './fault.ts';
import { Ui } from './ui.ts';

/**
 * Turns a filled-in form into the one file that gets encrypted, and back again.
 *
 * The container is a tar, so what the owner ends up with is real files with
 * real names: `age -d -i key.txt | tar -x` and the fields are on disk. A JSON
 * envelope with base64 blobs would have been easier to write and useless at
 * exactly the moment it matters.
 */
export class Parcel {
  static readonly TEXT = '.txt';
  static readonly NOTE = 'secret.txt';

  /** Reads the form and packs it. Throws before encrypting anything empty. */
  static async pack(fields: readonly Field.View[]): Promise<Uint8Array> {
    if (fields.length === 0) return Parcel.single();

    const entries: Tar.Entry[] = [];
    for (const field of fields) {
      const entry = await Parcel.read(field);
      if (entry) entries.push(entry);
      else if (field.required) throw Parcel.missing(field);
    }

    if (entries.length === 0) {
      throw Fault.of('submission.empty', 'Nothing to send', 'Fill in at least one field first.');
    }
    return Tar.pack(entries);
  }

  private static single(): Uint8Array {
    const text = Ui.value('secret');
    if (text.length === 0) {
      throw Fault.of('submission.empty', 'Nothing to send', 'Type the secret first.');
    }
    return Tar.pack([{ name: Parcel.NOTE, bytes: new TextEncoder().encode(text) }]);
  }

  private static async read(field: Field.View): Promise<Tar.Entry | null> {
    const input = Ui.el<HTMLInputElement | HTMLTextAreaElement>(`f-${field.key}`);

    if (field.kind === 'file') {
      const file = (input as HTMLInputElement).files?.[0];
      if (!file) return null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { name: `${field.key}-${Parcel.safe(file.name)}`, bytes };
    }

    const text = input.value;
    if (text.length === 0) return null;
    return { name: `${field.key}${Parcel.TEXT}`, bytes: new TextEncoder().encode(text) };
  }

  /** Filenames come from a stranger, so they are reduced to something safe. */
  private static safe(name: string): string {
    const cleaned = name
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+/, '')
      .slice(-40);
    return cleaned.length > 0 ? cleaned : 'file';
  }

  private static missing(field: Field.View): Fault {
    return Fault.of(
      'field.required',
      'Something is missing',
      `"${field.label}" is required.`,
      'Fill it in, then send again.',
    );
  }

  /** What the owner sees: the entries, split into readable text and files. */
  static unpack(archive: Uint8Array): Parcel.Item[] {
    return Tar.unpack(archive).map((entry) => ({
      name: entry.name,
      bytes: entry.bytes,
      text: entry.name.endsWith(Parcel.TEXT) ? new TextDecoder().decode(entry.bytes) : null,
    }));
  }

  static fields(): Field.View[] {
    const raw = Ui.data('root', 'fields');
    if (!raw) return [];
    return JSON.parse(raw) as Field.View[];
  }
}

export namespace Parcel {
  export interface Item {
    readonly name: string;
    readonly bytes: Uint8Array;
    /** The contents when the entry is text, or null when it is a file. */
    readonly text: string | null;
  }
}
