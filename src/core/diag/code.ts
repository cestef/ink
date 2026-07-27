/**
 * The closed set of things that can go wrong, each owning its own HTTP status
 * and headline. Status lives here rather than at the throw site so one failure
 * cannot answer 400 in one handler and 403 in another.
 */
export class Code {
  private static readonly REGISTRY = new Map<string, Code>();

  private constructor(
    readonly id: string,
    readonly status: Code.Status,
    readonly title: string,
  ) {}

  private static of(id: string, status: Code.Status, title: string): Code {
    const code = new Code(id, status, title);
    Code.REGISTRY.set(id, code);
    return code;
  }

  static readonly BODY_INVALID = Code.of('body.invalid', 400, 'malformed request body');

  static readonly SLUG_INVALID = Code.of('slug.invalid', 400, 'invalid address');
  static readonly SLUG_RESERVED = Code.of('slug.reserved', 400, 'reserved address');
  static readonly SLUG_TAKEN = Code.of('slug.taken', 409, 'address already in use');

  static readonly TITLE_INVALID = Code.of('title.invalid', 400, 'invalid title');
  static readonly RECIPIENT_INVALID = Code.of('recipient.invalid', 400, 'invalid recipient');
  static readonly IDENTITY_INVALID = Code.of('identity.invalid', 400, 'invalid wrapped identity');
  static readonly WRAPPING_INVALID = Code.of('wrapping.invalid', 400, 'invalid unlock method');
  static readonly WRAPPING_NONE = Code.of('wrapping.none', 400, 'no unlock method');
  static readonly WRAPPING_MANY = Code.of('wrapping.many', 409, 'too many unlock methods');

  static readonly INBOX_MISSING = Code.of('inbox.missing', 404, 'no such inbox');
  static readonly INBOX_CLOSED = Code.of('inbox.closed', 409, 'inbox is closed');
  static readonly SUBMISSION_MISSING = Code.of('submission.missing', 404, 'no such submission');
  static readonly SUBMISSION_EMPTY = Code.of('submission.empty', 400, 'empty submission');
  static readonly SUBMISSION_LARGE = Code.of('submission.large', 413, 'submission too large');
  static readonly SUBMISSION_QUOTA = Code.of('submission.quota', 429, 'inbox is full');
  static readonly SUBMISSION_EXPIRED = Code.of('submission.expired', 410, 'submission expired');
  static readonly RETENTION_INVALID = Code.of('retention.invalid', 400, 'invalid retention period');
  static readonly FIELD_INVALID = Code.of('field.invalid', 400, 'invalid field');
  static readonly FIELD_MANY = Code.of('field.many', 400, 'too many fields');

  static readonly TOKEN_MISSING = Code.of('token.missing', 403, 'missing manage token');
  static readonly TOKEN_INVALID = Code.of('token.invalid', 403, 'wrong manage token');

  static readonly ROUTE_MISSING = Code.of('route.missing', 404, 'no such route');

  /** Never served: invariants and tooling, carried as diagnostics all the same. */
  static readonly ROUTE_PARAM = Code.of('route.param', 500, 'route parameter missing');
  static readonly TAR_NAME = Code.of('tar.name', 500, 'archive entry name too long');
  static readonly BLOB_KEY = Code.of('blob.key', 500, 'malformed blob key');
  static readonly BUILD_FAILED = Code.of('build.failed', 500, 'build failed');
  static readonly INTERNAL = Code.of('internal', 500, 'internal error');

  static find(id: string): Code | null {
    return Code.REGISTRY.get(id) ?? null;
  }

  static all(): Code[] {
    return [...Code.REGISTRY.values()];
  }

  toString(): string {
    return this.id;
  }
}

export namespace Code {
  export type Status = 400 | 403 | 404 | 409 | 410 | 413 | 429 | 500;
}
