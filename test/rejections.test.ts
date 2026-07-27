import { describe, expect, test } from 'bun:test';
import { Diag } from '../src/core/diag/index.ts';
import { Recipient } from '../src/core/recipient.ts';
import { Slug } from '../src/core/slug.ts';
import { Wrapped } from '../src/core/wrapped.ts';
import { Inbox } from '../src/store/inbox.ts';
import { Diagnose } from './harness/diagnose.ts';
import { Suite } from './harness/suite.ts';

interface Rejection extends Diagnose.Expected {
  readonly name: string;
  readonly parse: string;
  readonly input?: unknown;
  readonly repeat?: number;
}

class Parse {
  static readonly BY: Record<string, (input: unknown) => unknown> = {
    slug: (input) => Slug.parse(input),
    recipient: (input) => Recipient.parse(input),
    wrapped: (input) => Wrapped.parse(input),
    title: (input) => Inbox.title(input),
  };

  static run(kind: string, input: unknown): unknown {
    const parser = Parse.BY[kind];
    if (!parser) throw new Error(`no parser named ${kind}`);
    return parser(input);
  }

  static input(one: Rejection): unknown {
    return one.repeat === undefined ? one.input : 'x'.repeat(one.repeat);
  }

  /** Runs a case and hands back the diagnostic, failing if none was raised. */
  static reject(one: Rejection): Diag {
    try {
      Parse.run(one.parse, Parse.input(one));
    } catch (cause) {
      expect(cause).toBeInstanceOf(Diag);
      return cause as Diag;
    }
    throw new Error(`${one.parse} accepted an input it should have rejected`);
  }
}

for (const suite of await Suite.all<Rejection[]>(`${import.meta.dir}/rejections`)) {
  describe(`rejections/${suite.name}`, () => {
    for (const one of suite.data) {
      test(one.name, () => Diagnose.check(Parse.reject(one), one));
    }
  });
}
