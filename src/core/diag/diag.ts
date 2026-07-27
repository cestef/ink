import type { Code } from './code.ts';
import { Render } from './render.ts';
import type { Span } from './span.ts';

/**
 * A user-facing failure: a code, a message, the input it points at, and optional
 * help. Built by chaining, so a throw site reads as one statement and nothing
 * has to pass `undefined` for the parts it does not have.
 */
export class Diag extends Error {
  readonly spans: readonly Span[];
  readonly help: readonly string[];
  readonly notes: readonly string[];
  readonly source: string | null;

  private constructor(
    readonly code: Code,
    message: string,
    parts: Diag.Parts = {},
  ) {
    super(message);
    this.name = 'Diag';
    this.source = parts.source ?? null;
    this.spans = parts.spans ?? [];
    this.help = parts.help ?? [];
    this.notes = parts.notes ?? [];
  }

  static of(code: Code, message: string): Diag {
    return new Diag(code, message);
  }

  private with(parts: Diag.Parts): Diag {
    const source = parts.source ?? this.source;
    return new Diag(this.code, this.message, {
      ...(source === null ? {} : { source }),
      spans: [...this.spans, ...(parts.spans ?? [])],
      help: [...this.help, ...(parts.help ?? [])],
      notes: [...this.notes, ...(parts.notes ?? [])],
    });
  }

  withSource(source: string, ...spans: Span[]): Diag {
    return this.with({ source, spans });
  }

  withHelp(...help: string[]): Diag {
    return this.with({ help });
  }

  withNote(...notes: string[]): Diag {
    return this.with({ notes });
  }

  get status(): Code.Status {
    return this.code.status;
  }

  /** The wire shape. Spans travel so a client can point at the input too. */
  view(): Diag.View {
    return {
      code: this.code.id,
      title: this.code.title,
      message: this.message,
      ...(this.source === null ? {} : { spans: this.spans.map((s) => s.view()) }),
      ...(this.help.length === 0 ? {} : { help: [...this.help] }),
      ...(this.notes.length === 0 ? {} : { notes: [...this.notes] }),
    };
  }

  /** The structured form: what a renderer draws, and what a test inspects. */
  plan(): Render.Plan {
    return Render.plan(this.parts());
  }

  render(): string {
    return Render.text(this.parts());
  }

  private parts(): Render.Input {
    return {
      code: this.code,
      message: this.message,
      source: this.source,
      spans: this.spans,
      help: this.help,
      notes: this.notes,
    };
  }

  response(): Response {
    return Response.json({ error: this.view() }, { status: this.status });
  }
}

export namespace Diag {
  export interface Parts {
    readonly source?: string;
    readonly spans?: readonly Span[];
    readonly help?: readonly string[];
    readonly notes?: readonly string[];
  }

  export interface View {
    readonly code: string;
    readonly title: string;
    readonly message: string;
    readonly spans?: readonly Span.View[];
    readonly help?: readonly string[];
    readonly notes?: readonly string[];
  }
}
