/**
 * A benchmark harness small enough to trust. Reports percentiles rather than a
 * mean: the tail is what a request budget is spent on, and an average hides it.
 */
export class Bench {
  static readonly WARMUP = 20;
  static readonly RUNS = 200;
  static readonly NS = 1_000_000;

  private readonly results: Bench.Result[] = [];

  async measure(name: string, run: () => unknown | Promise<unknown>, runs = Bench.RUNS): Promise<void> {
    for (let i = 0; i < Bench.WARMUP; i++) await run();

    const samples = new Float64Array(runs);
    for (let i = 0; i < runs; i++) {
      const started = Bun.nanoseconds();
      await run();
      samples[i] = Bun.nanoseconds() - started;
    }

    this.results.push(Bench.summarise(name, samples));
  }

  private static summarise(name: string, samples: Float64Array): Bench.Result {
    const sorted = Float64Array.from(samples).sort();
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
      name,
      runs: sorted.length,
      mean: total / sorted.length,
      p50: Bench.percentile(sorted, 0.5),
      p99: Bench.percentile(sorted, 0.99),
    };
  }

  private static percentile(sorted: Float64Array, fraction: number): number {
    const index = Math.min(Math.ceil(fraction * sorted.length) - 1, sorted.length - 1);
    return sorted[Math.max(index, 0)] ?? 0;
  }

  report(): void {
    const width = Math.max(...this.results.map((result) => result.name.length));
    const head = ['bench'.padEnd(width), 'p50'.padStart(10), 'p99'.padStart(10), 'ops/s'.padStart(12)];
    console.error(head.join('  '));
    console.error('-'.repeat(head.join('  ').length));

    for (const result of this.results) {
      console.error(
        [
          result.name.padEnd(width),
          Bench.duration(result.p50).padStart(10),
          Bench.duration(result.p99).padStart(10),
          Math.round(1e9 / result.mean)
            .toLocaleString('en-US')
            .padStart(12),
        ].join('  '),
      );
    }
  }

  private static duration(ns: number): string {
    if (ns >= Bench.NS) return `${(ns / Bench.NS).toFixed(2)}ms`;
    if (ns >= 1_000) return `${(ns / 1_000).toFixed(1)}µs`;
    return `${Math.round(ns)}ns`;
  }
}

export namespace Bench {
  export interface Result {
    readonly name: string;
    readonly runs: number;
    readonly mean: number;
    readonly p50: number;
    readonly p99: number;
  }
}
