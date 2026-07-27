/**
 * Times as a distance from now. A submission list is read for what is new, and
 * "4 minutes ago" answers that where a timestamp has to be subtracted first.
 */
export class When {
  static readonly SECOND = 1000;
  static readonly MINUTE = 60 * When.SECOND;
  static readonly HOUR = 60 * When.MINUTE;
  static readonly DAY = 24 * When.HOUR;

  private static readonly SCALE = [
    { limit: When.MINUTE, step: When.SECOND, unit: 's' },
    { limit: When.HOUR, step: When.MINUTE, unit: 'm' },
    { limit: When.DAY, step: When.HOUR, unit: 'h' },
    { limit: Number.POSITIVE_INFINITY, step: When.DAY, unit: 'd' },
  ] as const;

  static ago(at: number, now: number): string {
    const gap = Math.max(0, now - at);
    if (gap < 10 * When.SECOND) return 'just now';

    const scale = When.SCALE.find((entry) => gap < entry.limit) ?? When.SCALE[When.SCALE.length - 1]!;
    return `${Math.floor(gap / scale.step)}${scale.unit} ago`;
  }

  /** A duration, for policy rather than for a point in time. */
  static span(ms: number): string {
    const scale = When.SCALE.find((entry) => ms < entry.limit) ?? When.SCALE[When.SCALE.length - 1]!;
    return `${Math.round(ms / scale.step)}${scale.unit}`;
  }

  static exact(at: number): string {
    return new Date(at).toLocaleString();
  }
}
