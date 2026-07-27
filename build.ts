import { rm } from 'node:fs/promises';
import { Code, Diag } from './src/core/diag/index.ts';

/**
 * Builds the three crypto-surface bundles and records a subresource integrity
 * hash for each. The hash is the point: a published build can be diffed against
 * what the server actually serves.
 */
export class Build {
  static readonly ENTRIES = ['new', 'submit', 'manage'] as const;
  static readonly SRC = 'src/web';
  static readonly OUT = 'public/js';
  static readonly PUBLIC = '/js';
  static readonly ALG = 'sha384';
  static readonly MANIFEST = 'src/serve/manifest.json';

  static async run(): Promise<void> {
    // Bundles are content-addressed, so old ones linger and get deployed as
    // dead weight. Only what this build produced should ship.
    await rm(Build.OUT, { recursive: true, force: true });

    const manifest: Record<string, Build.Asset> = {};

    for (const entry of Build.ENTRIES) {
      const result = await Bun.build({
        entrypoints: [`${Build.SRC}/${entry}.ts`],
        outdir: Build.OUT,
        target: 'browser',
        format: 'esm',
        minify: true,
        naming: '[name]-[hash].[ext]',
      });

      if (!result.success) {
        throw Diag.of(Code.BUILD_FAILED, `failed to build ${entry}`).withNote(
          ...result.logs.map((log) => String(log)),
        );
      }

      const output = result.outputs.find((o) => o.kind === 'entry-point');
      if (!output) {
        throw Diag.of(Code.BUILD_FAILED, `no entry point emitted for ${entry}`).withNote(
          `bundler returned ${result.outputs.length} outputs`,
        );
      }

      const bytes = new Uint8Array(await output.arrayBuffer());
      const digest = new Bun.CryptoHasher(Build.ALG).update(bytes).digest('base64');
      const file = output.path.split('/').pop();

      manifest[entry] = {
        file: `${Build.PUBLIC}/${file}`,
        integrity: `${Build.ALG}-${digest}`,
        bytes: bytes.byteLength,
      };
    }

    await Bun.write(Build.MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

    for (const [entry, asset] of Object.entries(manifest)) {
      console.error(`${entry.padEnd(8)} ${String(asset.bytes).padStart(7)} B  ${asset.integrity}`);
    }
  }
}

namespace Build {
  export interface Asset {
    readonly file: string;
    readonly integrity: string;
    readonly bytes: number;
  }
}

if (import.meta.main) {
  try {
    await Build.run();
  } catch (cause) {
    console.error(cause instanceof Diag ? cause.render() : cause);
    process.exit(1);
  }
}
