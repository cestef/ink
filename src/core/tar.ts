import { Code, Diag } from './diag/index.ts';

/**
 * A minimal ustar writer and reader.
 *
 * A submission with several fields has to arrive as one encrypted file, and
 * that file has to stay openable with ordinary tools. `age -d | tar -x` gives
 * back real files with real names, which JSON with base64 blobs would not. That
 * is the whole reason this exists rather than a bespoke container.
 *
 * Deliberately small: regular files only, no links, no sparse, no pax. Anything
 * a submission can hold fits in that, and every byte here ships to a browser.
 */
export class Tar {
  static readonly BLOCK = 512;
  static readonly NAME_MAX = 100;
  static readonly MAGIC = 'ustar\0';
  static readonly VERSION = '00';
  static readonly FILE = '0';
  /** Fixed, so an archive says nothing about when it was made. */
  static readonly MTIME = 0;
  static readonly MODE = 0o644;

  static pack(entries: readonly Tar.Entry[]): Uint8Array {
    const blocks: Uint8Array[] = [];

    for (const entry of entries) {
      blocks.push(Tar.header(entry));
      blocks.push(entry.bytes);
      const remainder = entry.bytes.length % Tar.BLOCK;
      if (remainder !== 0) blocks.push(new Uint8Array(Tar.BLOCK - remainder));
    }

    // Two zero blocks close the archive.
    blocks.push(new Uint8Array(Tar.BLOCK * 2));
    return Tar.join(blocks);
  }

  static unpack(archive: Uint8Array): Tar.Entry[] {
    const entries: Tar.Entry[] = [];
    let at = 0;

    while (at + Tar.BLOCK <= archive.length) {
      const header = archive.subarray(at, at + Tar.BLOCK);
      if (header.every((byte) => byte === 0)) break;

      const name = Tar.text(header, 0, Tar.NAME_MAX);
      const size = Tar.octal(header, 124, 12);
      at += Tar.BLOCK;

      if (Tar.text(header, 156, 1) === Tar.FILE || name.length > 0) {
        entries.push({ name, bytes: archive.slice(at, at + size) });
      }

      at += Math.ceil(size / Tar.BLOCK) * Tar.BLOCK;
    }

    return entries;
  }

  private static header(entry: Tar.Entry): Uint8Array {
    const block = new Uint8Array(Tar.BLOCK);
    const name = new TextEncoder().encode(entry.name);

    // Names are built from a field key and a sanitised filename, so this is an
    // invariant rather than bad input. ustar has no room for more without pax.
    if (name.length > Tar.NAME_MAX) {
      throw Diag.of(Code.TAR_NAME, `"${entry.name}" is too long for a tar entry`)
        .withNote(`the limit is ${Tar.NAME_MAX} bytes, this is ${name.length}`)
        .withHelp('shorten the field label or the uploaded filename');
    }

    block.set(name, 0);
    Tar.write(block, 100, 8, Tar.MODE);
    Tar.write(block, 108, 8, 0);
    Tar.write(block, 116, 8, 0);
    Tar.write(block, 124, 12, entry.bytes.length);
    Tar.write(block, 136, 12, Tar.MTIME);
    block[156] = Tar.FILE.charCodeAt(0);
    block.set(new TextEncoder().encode(Tar.MAGIC), 257);
    block.set(new TextEncoder().encode(Tar.VERSION), 263);

    // The checksum is computed with its own field read as spaces.
    block.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of block) sum += byte;

    const checksum = `${sum.toString(8).padStart(6, '0')}\0 `;
    block.set(new TextEncoder().encode(checksum), 148);
    return block;
  }

  /** Octal, zero padded, NUL terminated: how ustar spells a number. */
  private static write(block: Uint8Array, at: number, width: number, value: number): void {
    const text = `${value.toString(8).padStart(width - 1, '0')}\0`;
    block.set(new TextEncoder().encode(text), at);
  }

  private static octal(block: Uint8Array, at: number, width: number): number {
    const text = Tar.text(block, at, width).trim();
    return text.length === 0 ? 0 : Number.parseInt(text, 8);
  }

  private static text(block: Uint8Array, at: number, width: number): string {
    const slice = block.subarray(at, at + width);
    const end = slice.indexOf(0);
    return new TextDecoder().decode(end === -1 ? slice : slice.subarray(0, end));
  }

  private static join(blocks: readonly Uint8Array[]): Uint8Array {
    const total = blocks.reduce((sum, block) => sum + block.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const block of blocks) {
      out.set(block, at);
      at += block.length;
    }
    return out;
  }
}

export namespace Tar {
  export interface Entry {
    readonly name: string;
    readonly bytes: Uint8Array;
  }
}
