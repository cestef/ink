/** The one place a TypeScript field becomes a SQL identifier. */
export class Name {
  static readonly SEP = '_';

  static snake(field: string): string {
    return field.replace(/[A-Z]/g, (c) => Name.SEP + c.toLowerCase());
  }
}
