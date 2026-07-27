import type { Diag } from '../core/diag/diag.ts';

/**
 * The browser's view of a failure. Server diagnostics arrive whole, so help and
 * notes reach the reader instead of being flattened into one line, and faults
 * raised in the tab carry the same shape.
 */
export class Fault extends Error {
  readonly code: string;
  readonly title: string;
  readonly help: readonly string[];
  readonly notes: readonly string[];

  private constructor(view: Diag.View) {
    super(view.message);
    this.name = 'Fault';
    this.code = view.code;
    this.title = view.title;
    this.help = view.help ?? [];
    this.notes = view.notes ?? [];
  }

  static of(code: string, title: string, message: string, ...help: string[]): Fault {
    return new Fault({ code, title, message, help });
  }

  /** Reads a diagnostic off a failed response, falling back to the status. */
  static async from(response: Response): Promise<Fault> {
    const body = (await response.json().catch(() => null)) as { error?: Diag.View } | null;
    if (body?.error) return new Fault(body.error);
    return Fault.of(
      'response.unreadable',
      'unexpected response',
      `the server answered ${response.status} with no diagnostic`,
    );
  }

  /**
   * One heading, one sentence, then the detail. Anything thrown becomes this,
   * so a failure is rendered as a single block rather than a stack of
   * equally-weighted lines with no shape.
   */
  static describe(cause: unknown): Fault.Detail {
    if (cause instanceof Fault) {
      return { title: cause.title, message: cause.message, lines: [...cause.notes, ...cause.help] };
    }
    if (cause instanceof Error) {
      return { title: 'Something went wrong', message: cause.message, lines: [] };
    }
    return { title: 'Something went wrong', message: 'No further detail was reported.', lines: [] };
  }
}

export namespace Fault {
  export interface Detail {
    readonly title: string;
    readonly message: string;
    readonly lines: readonly string[];
  }
}
