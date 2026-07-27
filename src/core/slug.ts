import { Code, Diag, Span } from './diag/index.ts';

/** The label an inbox lives at. One day it is a subdomain, so keep it DNS-shaped. */
export class Slug {
  static readonly MIN = 3;
  static readonly MAX = 40;
  static readonly SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  static readonly CHAR = /[a-z0-9-]/;
  /**
   * A slug becomes a hostname, so anything that could shadow infrastructure on
   * the same domain is refused: mail routing, well-known service names, and the
   * paths this app already serves.
   */
  static readonly RESERVED = new Set([
    'admin',
    'api',
    'app',
    'assets',
    'autodiscover',
    'blog',
    'cdn',
    'dev',
    'docs',
    'ftp',
    'i',
    'imap',
    'ink',
    'localhost',
    'mail',
    'mx',
    'new',
    'ns',
    'ns1',
    'ns2',
    'smtp',
    'ssl',
    'staging',
    'static',
    'status',
    'support',
    'test',
    'webmail',
    'www',
  ]);

  private constructor(readonly value: string) {}

  static parse(input: unknown): Slug {
    if (typeof input !== 'string') {
      throw Diag.of(Code.SLUG_INVALID, 'address must be text').withNote(`received ${typeof input}`);
    }
    Slug.length(input);
    Slug.shape(input);
    Slug.reserved(input);
    return new Slug(input);
  }

  private static length(input: string): void {
    if (input.length >= Slug.MIN && input.length <= Slug.MAX) return;
    const short = input.length < Slug.MIN;
    throw Diag.of(Code.SLUG_INVALID, `address must be ${Slug.MIN} to ${Slug.MAX} characters`)
      .withSource(input, Span.whole(input, short ? 'too short' : 'too long'))
      .withHelp(`this one is ${input.length}`);
  }

  private static shape(input: string): void {
    if (Slug.SHAPE.test(input)) return;
    throw Diag.of(Code.SLUG_INVALID, 'address must be lowercase letters, digits and hyphens')
      .withSource(input, Slug.blame(input))
      .withHelp('a hyphen may sit between characters, never at either end');
  }

  private static blame(input: string): Span {
    const first = input[0] ?? '';
    if (first === '-') return Span.at(input, 0, 'cannot start with a hyphen');
    if (input.endsWith('-')) return Span.at(input, input.length - 1, 'cannot end with a hyphen');
    return Span.offending(input, Slug.CHAR, 'not allowed here');
  }

  private static reserved(input: string): void {
    if (!Slug.RESERVED.has(input)) return;
    throw Diag.of(Code.SLUG_RESERVED, `"${input}" is reserved`)
      .withSource(input, Span.whole(input, 'reserved'))
      .withHelp('this name is kept for mail, DNS or the site itself, so pick another');
  }

  toString(): string {
    return this.value;
  }
}
