import { Code, Diag } from './diag/index.ts';

/**
 * How long an inbox keeps what it is sent. The whole point of the product is
 * shrinking the window in which a credential exists somewhere it should not, so
 * a secret that outlives its usefulness is the failure mode, not the default.
 *
 * The choices are a closed set rather than a free number: an arbitrary duration
 * is a way to store something for a decade by typo.
 */
export class Retention {
  static readonly HOUR = 60 * 60 * 1000;
  static readonly DAY = 24 * Retention.HOUR;

  static readonly OPTIONS: readonly Retention.Option[] = [
    { value: 'week', label: 'Delete after 7 days', ms: 7 * Retention.DAY },
    { value: 'day', label: 'Delete after 24 hours', ms: Retention.DAY },
    { value: 'hour', label: 'Delete after 1 hour', ms: Retention.HOUR },
    { value: 'forever', label: 'Keep until I delete them', ms: null },
  ];

  static readonly DEFAULT = Retention.OPTIONS[0]!;

  /** Milliseconds to keep, or null to keep until someone deletes it. */
  static parse(input: unknown): number | null {
    if (input === undefined || input === null) return Retention.DEFAULT.ms;

    const option = Retention.OPTIONS.find((candidate) => candidate.value === input);
    if (option) return option.ms;

    throw Diag.of(Code.RETENTION_INVALID, 'unknown retention period')
      .withHelp(`accepted: ${Retention.OPTIONS.map((each) => each.value).join(', ')}`)
      .withNote(`received ${JSON.stringify(input)}`);
  }

  /** When a submission made at `at` stops being readable. */
  static expiry(retain: number | null, at: number): number | null {
    return retain === null ? null : at + retain;
  }

  static expired(retain: number | null, at: number, now: number): boolean {
    const expiry = Retention.expiry(retain, at);
    return expiry !== null && now >= expiry;
  }

  static label(retain: number | null): string {
    return Retention.OPTIONS.find((option) => option.ms === retain)?.label ?? 'Kept until deleted';
  }
}

export namespace Retention {
  export interface Option {
    readonly value: string;
    readonly label: string;
    readonly ms: number | null;
  }
}
