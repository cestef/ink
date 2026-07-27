import { Code, Diag, Span } from '../core/diag/index.ts';

/**
 * Ciphertext storage. Nothing here ever holds a plaintext byte, so the interface
 * stays deliberately dumb and any object store satisfies it.
 */
export interface Blobs {
  put(key: string, data: Blobs.Bytes): Promise<void>;
  get(key: string): Promise<Blobs.Bytes | null>;
  delete(key: string): Promise<void>;
}

export namespace Blobs {
  export const SHAPE = /^[0-9a-f]+$/;

  /** Pinned to an owned buffer so a body can be built without a cast. */
  export type Bytes = Uint8Array<ArrayBuffer>;

  export class R2 implements Blobs {
    constructor(private readonly bucket: Blobs.Bucket) {}

    async put(key: string, data: Blobs.Bytes): Promise<void> {
      await this.bucket.put(Blobs.check(key), data);
    }

    async get(key: string): Promise<Blobs.Bytes | null> {
      const object = await this.bucket.get(Blobs.check(key));
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    }

    async delete(key: string): Promise<void> {
      await this.bucket.delete(Blobs.check(key));
    }
  }

  export class Fs implements Blobs {
    constructor(private readonly dir: string) {}

    private path(key: string): string {
      return `${this.dir}/${Blobs.check(key)}`;
    }

    async put(key: string, data: Blobs.Bytes): Promise<void> {
      await Bun.write(this.path(key), data);
    }

    async get(key: string): Promise<Blobs.Bytes | null> {
      const file = Bun.file(this.path(key));
      return (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null;
    }

    async delete(key: string): Promise<void> {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.path(key)).catch(() => {});
    }
  }

  export class Memory implements Blobs {
    private readonly items = new Map<string, Blobs.Bytes>();

    /** How many blobs are held, so a test can assert bytes actually went. */
    get size(): number {
      return this.items.size;
    }

    async put(key: string, data: Blobs.Bytes): Promise<void> {
      this.items.set(Blobs.check(key), data);
    }

    async get(key: string): Promise<Blobs.Bytes | null> {
      return this.items.get(Blobs.check(key)) ?? null;
    }

    async delete(key: string): Promise<void> {
      this.items.delete(Blobs.check(key));
    }
  }

  /** Keys are minted by `Id`, so anything else is a bug rather than bad input. */
  export function check(key: string): string {
    if (Blobs.SHAPE.test(key)) return key;
    throw Diag.of(Code.BLOB_KEY, 'blob keys are lowercase hex')
      .withSource(key, Span.offending(key, /[0-9a-f]/, 'not hex'))
      .withNote('keys come from Id.make(), so this is an invariant, not user input');
  }

  /** The slice of R2 this uses, so the module compiles without workers types. */
  export interface Bucket {
    put(key: string, value: Uint8Array): Promise<unknown>;
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    delete(key: string): Promise<void>;
  }
}
