/**
 * Every cache decision this product makes. Bundles are content-hashed so they
 * are immutable forever; anything shaped by an inbox is never stored, because a
 * shared cache holding a page that names a recipient is a leak the crypto does
 * not cover.
 */
export class Cache {
  static readonly HEADER = 'cache-control';
  static readonly ASSET = 'public, max-age=31536000, immutable';
  static readonly PAGE = 'private, no-cache';
  static readonly NONE = 'no-store';
}
