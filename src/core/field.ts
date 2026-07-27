import { Code, Diag } from './diag/index.ts';

/**
 * One thing an inbox asks for. An inbox with no fields is a single free-text
 * box, which is what most of them want; adding fields turns it into a form.
 *
 * Labels are stored in the clear, because the submit page has to render them
 * and the sender has no key. That is the same exposure the title already has,
 * and it is worth saying out loud: ink hides what people send, not what you
 * asked for. Values are never in the clear, anywhere.
 *
 * `required` is a courtesy to the sender, not a guarantee to the owner. The
 * server cannot check a value it cannot read, so the browser enforces it and an
 * unusual client could ignore it.
 */
export class Field {
  static readonly MAX = 12;
  static readonly LABEL_MAX = 60;
  static readonly KEY_MAX = 40;

  static readonly KINDS: readonly Field.Option[] = [
    { kind: 'text', label: 'Single line', multiline: false },
    { kind: 'multiline', label: 'Several lines', multiline: true },
    { kind: 'secret', label: 'Secret, masked while typing', multiline: false },
    { kind: 'file', label: 'File upload', multiline: false },
  ];

  private constructor(
    readonly key: string,
    readonly label: string,
    readonly kind: Field.Kind,
    readonly required: boolean,
  ) {}

  static parse(input: unknown, at: number): Field {
    const record = (input ?? {}) as Record<string, unknown>;
    const label = Field.label(record.label);
    return new Field(Field.key(label, at), label, Field.kind(record.kind), record.required === true);
  }

  /** At most `Field.MAX`, because a form nobody finishes collects nothing. */
  static all(input: unknown): Field[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) {
      throw Diag.of(Code.FIELD_INVALID, 'fields must be a list');
    }
    if (input.length > Field.MAX) {
      throw Diag.of(Code.FIELD_MANY, `an inbox asks for at most ${Field.MAX} things`)
        .withHelp('ask for what you need now, not everything you might ever need')
        .withNote(`received ${input.length}`);
    }
    return input.map((entry, at) => Field.parse(entry, at));
  }

  static kind(input: unknown): Field.Kind {
    const match = Field.KINDS.find((option) => option.kind === input);
    if (match) return match.kind;

    throw Diag.of(Code.FIELD_INVALID, 'unknown field kind')
      .withHelp(`accepted: ${Field.KINDS.map((option) => option.kind).join(', ')}`)
      .withNote(`received ${JSON.stringify(input)}`);
  }

  private static label(input: unknown): string {
    if (typeof input !== 'string' || input.trim().length === 0) {
      throw Diag.of(Code.FIELD_INVALID, 'every field needs a label').withHelp(
        'the label is what the sender reads, so name the thing you want',
      );
    }
    const text = input.trim();
    if (text.length > Field.LABEL_MAX) {
      throw Diag.of(Code.FIELD_INVALID, `a label is at most ${Field.LABEL_MAX} characters`).withNote(
        `received ${text.length}`,
      );
    }
    return text;
  }

  /**
   * A filename-safe key from the label, prefixed by position so the extracted
   * archive lists in the order the form asked, and so two fields sharing a
   * label still land in two files.
   */
  private static key(label: string, at: number): string {
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, Field.KEY_MAX);
    return `${String(at + 1).padStart(2, '0')}-${slug.length > 0 ? slug : 'field'}`;
  }

  view(): Field.View {
    return { key: this.key, label: this.label, kind: this.kind, required: this.required };
  }
}

export namespace Field {
  export type Kind = 'text' | 'multiline' | 'secret' | 'file';

  export interface Option {
    readonly kind: Field.Kind;
    readonly label: string;
    readonly multiline: boolean;
  }

  export interface View {
    readonly key: string;
    readonly label: string;
    readonly kind: Field.Kind;
    readonly required: boolean;
  }
}
