import { Code, Diag } from './diag/index.ts';
import { Hex } from './hex.ts';

/**
 * Bearer secret for the manage side of an inbox. Prototype-grade authority: it
 * proves whoever calls holds the link the creator was handed, nothing more. It
 * guards metadata only, never plaintext, which stays sealed to the identity.
 */
export class Token {
  static readonly BYTES = 32;
  static readonly ALG = 'SHA-256';
  static readonly HEADER = 'x-ink-token';

  private constructor(readonly secret: string) {}

  static make(): Token {
    return new Token(Hex.random(Token.BYTES));
  }

  static from(request: Request): Token {
    const header = request.headers.get(Token.HEADER);
    if (!header) {
      throw Diag.of(Code.TOKEN_MISSING, `missing the ${Token.HEADER} header`)
        .withHelp('the manage link carries this token after its #')
        .withNote('submitting needs no token, only listing and reading do');
    }
    return new Token(header);
  }

  async hash(): Promise<string> {
    const bytes = new TextEncoder().encode(this.secret);
    const digest = await crypto.subtle.digest(Token.ALG, bytes);
    return Hex.encode(new Uint8Array(digest));
  }

  async check(expected: string): Promise<void> {
    if (Token.equal(await this.hash(), expected)) return;
    throw Diag.of(Code.TOKEN_INVALID, 'this manage token does not match this inbox').withHelp(
      'open the manage link you were given when the inbox was created',
    );
  }

  private static equal(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
}
