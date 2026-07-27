import { Field } from '../core/field.ts';
import { Ui } from './ui.ts';

/**
 * The form the sender will fill in. Rows are added here and read back at
 * submit; nothing is stored until the inbox is created.
 */
export class Form {
  private static readonly rows: HTMLElement[] = [];

  static wire(): void {
    Ui.el<HTMLButtonElement>('add').addEventListener('click', () => Form.add());
  }

  static add(): void {
    if (Form.rows.length >= Field.MAX) return;

    const label = Ui.make('input', { type: 'text', placeholder: 'AWS access key', autocomplete: 'off' });
    const kind = Ui.make(
      'select',
      {},
      Field.KINDS.map((option) => Ui.option(option.kind, option.label)),
    );
    const required = Ui.make('input', { type: 'checkbox' });
    const drop = Ui.make('button', { type: 'button', textContent: 'Remove' });

    const row = Ui.make('div', { className: 'field' }, [
      Ui.make('div', { className: 'row' }, [label, kind]),
      Ui.make('div', { className: 'actions' }, [
        Ui.make('label', { className: 'check' }, [required, Ui.make('span', { textContent: 'Required' })]),
        drop,
      ]),
    ]);

    drop.addEventListener('click', () => {
      row.remove();
      Form.rows.splice(Form.rows.indexOf(row), 1);
    });

    Form.rows.push(row);
    Ui.el('fields').append(row);
  }

  /** What the API stores: a label, a kind and whether the sender may skip it. */
  static read(): Form.Entry[] {
    return Form.rows
      .map((row) => ({
        label: row.querySelector('input[type=text]')?.value?.trim() ?? '',
        kind: row.querySelector('select')?.value ?? 'text',
        required: row.querySelector('input[type=checkbox]')?.checked === true,
      }))
      .filter((entry) => entry.label.length > 0);
  }
}

export namespace Form {
  export interface Entry {
    readonly label: string;
    readonly kind: string;
    readonly required: boolean;
  }
}
