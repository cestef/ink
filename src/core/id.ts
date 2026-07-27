import { Hex } from './hex.ts';

export class Id {
  static readonly BYTES = 16;

  static make(): string {
    return Hex.random(Id.BYTES);
  }

  static is(s: string): boolean {
    return new RegExp(`^[0-9a-f]{${Id.BYTES * 2}}$`).test(s);
  }
}
