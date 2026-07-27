import { expect } from 'bun:test';
import type { Diag } from '../../src/core/diag/index.ts';
import { Code } from '../../src/core/diag/index.ts';
import type { Render } from '../../src/core/diag/render.ts';

/**
 * Checks a diagnostic against an expectation declared in YAML. Only the keys a
 * scenario names are asserted, so a case can pin a caret column without also
 * restating every help line.
 */
export class Diagnose {
  static check(diag: Diag, expected: Diagnose.Expected): void {
    const plan = diag.plan();

    expect(plan.code).toBe(expected.code);
    // The code must be registered, which keeps the wire value and the registry honest.
    expect(Code.find(expected.code)).toBe(diag.code);

    Diagnose.same('status', plan.status, expected.status);
    Diagnose.same('title', plan.title, expected.title);
    Diagnose.same('message', plan.message, expected.message);
    Diagnose.list('help', plan.help, expected.help);
    Diagnose.list('notes', plan.notes, expected.notes);
    Diagnose.marks(plan.marks, expected);
  }

  private static marks(actual: readonly Render.Mark[], expected: Diagnose.Expected): void {
    if (expected.marks === 0) {
      expect(actual.length).toBe(0);
      return;
    }
    if (expected.marks !== undefined) expect(actual.length).toBe(expected.marks);
    if (expected.mark === undefined) return;

    const first = actual[0];
    expect(first).toBeDefined();
    for (const [key, value] of Object.entries(expected.mark)) {
      expect({ [key]: first?.[key as keyof Render.Mark] }).toEqual({ [key]: value });
    }
  }

  private static same<T>(field: string, actual: T, expected: T | undefined): void {
    if (expected === undefined) return;
    expect({ [field]: actual }).toEqual({ [field]: expected });
  }

  private static list(
    field: string,
    actual: readonly string[],
    expected: readonly string[] | undefined,
  ): void {
    if (expected === undefined) return;
    expect({ [field]: [...actual] }).toEqual({ [field]: [...expected] });
  }
}

export namespace Diagnose {
  export interface Expected {
    readonly code: string;
    readonly status?: number;
    readonly title?: string;
    readonly message?: string;
    readonly help?: readonly string[];
    readonly notes?: readonly string[];
    /** How many spans the diagnostic carries. Zero asserts it points at nothing. */
    readonly marks?: number;
    /** Field-by-field expectations for the first span, all of them optional. */
    readonly mark?: Partial<Render.Mark>;
  }
}
