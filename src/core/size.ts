/** Byte counts as a reader would say them. */
export class Size {
  static readonly UNITS = ['B', 'KB', 'MB', 'GB'] as const;
  static readonly STEP = 1024;

  static human(bytes: number): string {
    let value = bytes;
    let unit = 0;

    while (value >= Size.STEP && unit < Size.UNITS.length - 1) {
      value /= Size.STEP;
      unit += 1;
    }

    // Bytes are whole; anything scaled gets one decimal, and loses it when the
    // decimal is a zero, so a column of sizes stays narrow.
    const shown = unit === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, '');
    return `${shown} ${Size.UNITS[unit]}`;
  }
}
