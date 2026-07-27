import { describe, expect, test } from 'bun:test';
import { Build } from '../build.ts';
import manifest from '../src/serve/manifest.json' with { type: 'json' };

/**
 * The crypto surface is delivered by the same server it protects you from, so
 * the only real answer is that what is served can be checked against what was
 * published. These pin the parts of that claim a test can actually hold:
 * the bundle on disk matches its recorded hash, and the page pins that hash.
 *
 * What no test can establish is that the published build came from this source.
 * That needs a third party rebuilding it, which is why the build is
 * deterministic and the hash is printed on every run.
 */
describe('bundle integrity', () => {
  for (const entry of Build.ENTRIES) {
    test(`${entry} on disk matches its published hash`, async () => {
      const asset = manifest[entry];
      const file = Bun.file(`public${asset.file}`);
      expect(await file.exists()).toBe(true);

      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = new Bun.CryptoHasher(Build.ALG).update(bytes).digest('base64');

      expect(`${Build.ALG}-${digest}`).toBe(asset.integrity);
      expect(bytes.byteLength).toBe(asset.bytes);
    });
  }

  test('every bundle is content addressed, so a change cannot reuse a URL', () => {
    const files = Build.ENTRIES.map((entry) => manifest[entry].file);
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) expect(file).toMatch(/^\/js\/[a-z]+-[a-z0-9]+\.js$/);
  });
});
