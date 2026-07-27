/**
 * Loads a directory of YAML scenarios. Adding a case must never mean touching a
 * `.ts` file, so the runners hold the behaviour and the fixtures hold the table.
 */
export class Suite<T> {
  static readonly EXT = '.yaml';

  private constructor(
    readonly name: string,
    readonly data: T,
  ) {}

  static async all<T>(dir: string): Promise<Suite<T>[]> {
    const glob = new Bun.Glob(`*${Suite.EXT}`);
    const suites: Suite<T>[] = [];
    for await (const file of glob.scan({ cwd: dir })) {
      const text = await Bun.file(`${dir}/${file}`).text();
      suites.push(new Suite(file.slice(0, -Suite.EXT.length), Bun.YAML.parse(text) as T));
    }
    return suites.sort((a, b) => a.name.localeCompare(b.name));
  }
}
