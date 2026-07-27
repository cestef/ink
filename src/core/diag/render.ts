import type { Code } from './code.ts';
import type { Span } from './span.ts';

/**
 * Turns a diagnostic into a structured plan, then into compiler-shaped text.
 * The plan is the seam: callers that want to inspect a diagnostic read typed
 * marks rather than matching substrings of the rendering.
 */
export class Render {
  static readonly GUTTER = ' │ ';
  static readonly MARK = ' · ';
  static readonly CARET = '▲';
  static readonly ELBOW = '╰──';

  static plan(input: Render.Input): Render.Plan {
    const source = input.source;
    return {
      code: input.code.id,
      status: input.code.status,
      title: input.code.title,
      message: input.message,
      marks: source === null ? [] : input.spans.map((span) => Render.mark(source, span)),
      help: [...input.help],
      notes: [...input.notes],
    };
  }

  /** Where a span actually lands: line, column, and how wide the carets run. */
  static mark(source: string, span: Span): Render.Mark {
    const place = Render.locate(source, span.start);
    const room = Math.max(place.text.length - place.column, 1);
    return {
      line: place.line,
      column: place.column,
      width: Math.max(Math.min(span.length, room), 1),
      text: place.text,
      label: span.label,
    };
  }

  static text(input: Render.Input): string {
    const plan = Render.plan(input);
    const lines = [`× ${plan.message}`, `  ╭─[${plan.code}]`];
    for (const mark of plan.marks) lines.push(...Render.rows(mark));
    lines.push('  ╰────');
    for (const help of plan.help) lines.push(`  help: ${help}`);
    for (const note of plan.notes) lines.push(`  note: ${note}`);
    return lines.join('\n');
  }

  private static rows(mark: Render.Mark): string[] {
    const width = String(mark.line).length;
    const number = String(mark.line).padStart(width);
    const blank = ' '.repeat(width);
    const pad = ' '.repeat(mark.column);
    return [
      `${number}${Render.GUTTER}${mark.text}`,
      `${blank}${Render.MARK}${pad}${Render.CARET.repeat(mark.width)}`,
      `${blank}${Render.MARK}${pad}${Render.ELBOW} ${mark.label}`,
    ];
  }

  /** Line and column of an absolute offset, both counted the way humans do. */
  private static locate(source: string, offset: number): Render.Place {
    const lines = source.split('\n');
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]!;
      if (offset <= seen + text.length) return { line: i + 1, column: offset - seen, text };
      seen += text.length + 1;
    }
    const last = lines.at(-1) ?? '';
    return { line: lines.length, column: last.length, text: last };
  }
}

export namespace Render {
  export interface Input {
    readonly code: Code;
    readonly message: string;
    readonly source: string | null;
    readonly spans: readonly Span[];
    readonly help: readonly string[];
    readonly notes: readonly string[];
  }

  export interface Mark {
    readonly line: number;
    readonly column: number;
    readonly width: number;
    readonly text: string;
    readonly label: string;
  }

  export interface Plan {
    readonly code: string;
    readonly status: Code.Status;
    readonly title: string;
    readonly message: string;
    readonly marks: readonly Render.Mark[];
    readonly help: readonly string[];
    readonly notes: readonly string[];
  }

  export interface Place {
    readonly line: number;
    readonly column: number;
    readonly text: string;
  }
}
