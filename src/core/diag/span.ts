/** A labelled range of the input a diagnostic points at. */
export class Span {
  constructor(
    readonly start: number,
    readonly length: number,
    readonly label: string,
  ) {}

  static whole(text: string, label: string): Span {
    return new Span(0, Math.max(text.length, 1), label);
  }

  static at(text: string, index: number, label: string): Span {
    return new Span(Math.min(index, Math.max(text.length - 1, 0)), 1, label);
  }

  /** The first character failing `allowed`, or the whole input when all pass. */
  static offending(text: string, allowed: RegExp, label: string): Span {
    for (let i = 0; i < text.length; i++) {
      if (!allowed.test(text[i]!)) return new Span(i, 1, label);
    }
    return Span.whole(text, label);
  }

  static from(text: string, index: number, label: string): Span {
    return new Span(index, Math.max(text.length - index, 1), label);
  }

  /** Rebases a span computed against a slice back onto the whole input. */
  shift(by: number): Span {
    return new Span(this.start + by, this.length, this.label);
  }

  get end(): number {
    return this.start + this.length;
  }

  view(): Span.View {
    return { start: this.start, length: this.length, label: this.label };
  }
}

export namespace Span {
  export interface View {
    readonly start: number;
    readonly length: number;
    readonly label: string;
  }
}
