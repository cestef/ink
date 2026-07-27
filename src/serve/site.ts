import type { Field } from '../core/field.ts';
import { Key } from '../core/key.ts';
import { Retention } from '../core/retention.ts';
import { Routes } from '../core/routes.ts';
import { Size } from '../core/size.ts';
import { Slug } from '../core/slug.ts';
import { Unlock } from '../core/unlock.ts';
import { When } from '../core/when.ts';
import { Inbox } from '../store/inbox.ts';
import { Schema } from '../store/schema.ts';
import { Submission } from '../store/submission.ts';
import type { Api } from './api.ts';
import type { App } from './app.ts';
import { Html } from './html.ts';
import { Page } from './page.ts';

/**
 * Three pages, one action each. Every control is a decision the reader has to
 * make; anything that could be inferred, defaulted or moved out of the way is.
 */
export class Site {
  static mount(app: App, ctx: Api.Ctx): App {
    app.get(Routes.page.home, () =>
      Page.render({
        entry: 'new',
        title: 'ink',
        heading: 'Ask for a secret.',
        sub: 'Share the link you get. They send; only you can open it.',
        body: Html.div({ id: 'root', data: { domain: ctx.domain ?? '' } }, [
          Html.label('slug', 'Address'),
          Html.input({ id: 'slug', placeholder: 'acme', autocomplete: 'off', spellcheck: 'false' }),

          Html.label('title', 'Asking for'),
          Html.input({ id: 'title', placeholder: 'Client credentials', autocomplete: 'off' }),

          Html.label(Unlock.CONTROL, 'Unlock with'),
          Site.select(
            Unlock.CONTROL,
            Unlock.OPTIONS.map((option) => ({ value: option.kind, label: option.label })),
          ),
          Html.p('', { class: 'hint', id: 'method-note' }),

          Html.div({ id: 'passphrase-field', hidden: true }, [
            Html.label('passphrase', 'Passphrase'),
            Html.div({ class: 'row' }, [
              Html.input({ id: 'passphrase', type: 'text', autocomplete: 'off', spellcheck: 'false' }),
              Html.button({ id: 'suggest' }, 'Generate'),
            ]),
          ]),

          Html.div({ class: 'label' }, 'What to ask for'),
          Html.p('Leave this empty for a single free-text box.', { class: 'hint' }),
          Html.div({ id: 'fields' }),
          Html.div({ class: 'actions' }, [Html.button({ id: 'add' }, 'Add a field')]),

          Html.div({ class: 'actions' }, [Html.button({ id: 'create' }, 'Create inbox')]),
          Html.div({ class: 'out', id: 'out' }),

          Html.label('retain', 'Keep submissions'),
          Site.select(
            'retain',
            Retention.OPTIONS.map((option) => ({ value: option.value, label: option.label })),
          ),

          Html.el('details', {}, [
            Html.el('summary', {}, 'Advanced'),
            Html.el('label', { class: 'check', for: 'burn' }, [
              Html.input({ id: 'burn', type: 'checkbox' }),
              Html.el('span', {}, [
                'Destroy on read',
                Html.el(
                  'em',
                  {},
                  'Each submission is deleted the moment you open it. There is no second look.',
                ),
              ]),
            ]),
            Html.label('kind', 'Key type'),
            Site.select(
              'kind',
              Key.OPTIONS.map((option) => ({ value: option.kind, label: option.label })),
            ),
            Html.p('', { class: 'hint', id: 'kind-note' }),
          ]),

          Site.terminal(ctx.domain),
          Site.footer(),
        ]),
      }),
    );

    app.get(Routes.page.inbox, async ({ params }) => {
      const inbox = await Inbox.bySlug(ctx.db, Slug.parse(params.slug));
      const view = inbox.view();

      if (inbox.closed) {
        return Page.render({
          entry: 'submit',
          mark: `ink / ${view.slug}`,
          title: `${view.title} · ink`,
          heading: view.title,
          sub: 'This inbox is closed and is not accepting anything new.',
          body: Html.p('Ask whoever sent you the link if it should be reopened.', { class: 'hint' }),
        });
      }

      const fields = (await Schema.of(ctx.db, inbox)).map((field) => field.view());

      return Page.render({
        entry: 'submit',
        mark: `ink / ${view.slug}`,
        title: `${view.title} · ink`,
        heading: view.title,
        // Facts a sender acts on: how long it lives and how much fits. The
        // reassurance this replaced told them nothing they could use.
        sub: Site.terms(inbox.policy()),
        body: Html.div(
          {
            id: 'root',
            data: {
              slug: view.slug,
              recipient: view.recipient,
              domain: ctx.domain ?? '',
              // The script reads this back to know what to collect and pack.
              fields: JSON.stringify(fields),
            },
          },
          [
            Html.div({ class: 'out', id: 'warn' }),
            ...(fields.length === 0 ? Site.single() : fields.map((field) => Site.field(field))),
            Html.div({ class: 'actions' }, [Html.button({ id: 'send' }, 'Seal and send')]),
            Html.div({ class: 'out', id: 'out' }),
            Html.div({ class: 'out', id: 'bypass' }),
          ],
        ),
      });
    });

    app.get(Routes.page.manage, async ({ params }) => {
      const view = (await Inbox.bySlug(ctx.db, Slug.parse(params.slug))).view();
      return Page.render({
        entry: 'manage',
        mark: `ink / ${view.slug}`,
        title: `${view.title} · ink`,
        heading: view.title,
        sub: null,
        // The unlock control is filled in once this inbox says how it opens, so
        // nobody is shown a passphrase box for an inbox that uses a passkey.
        body: Html.div({ id: 'root', data: { slug: view.slug, domain: ctx.domain ?? '' } }, [
          Html.div({ id: 'unlock' }, Html.p('Checking how this inbox opens.', { class: 'hint' })),
          Html.div({ class: 'out', id: 'out' }),
          Html.ul({ id: 'list' }),
        ]),
      });
    });

    return app;
  }

  static readonly SOURCE = 'https://github.com/cestef/ink';
  static readonly AGE = 'https://age-encryption.org';

  /** What a sender is agreeing to, in the fewest words that still say it. */
  private static terms(policy: Inbox.Policy): string {
    const kept = policy.burn
      ? 'Destroyed when opened'
      : policy.retain === null
        ? 'Kept until deleted'
        : `Kept ${When.span(policy.retain)}`;
    return `${kept} · ${Size.human(Submission.MAX)} max`;
  }

  /**
   * The same operations, without this page. Worth offering on the way in rather
   * than as a footnote: a sender who does not trust the browser is exactly the
   * reader this product is for, and the script is how they never load it.
   */
  private static terminal(domain: string | null | undefined): Html {
    const origin = domain ? `https://${domain}` : 'http://localhost:8787';
    const install = [
      `curl -fsSL ${origin}/ink -o ink`,
      'chmod +x ink',
      '',
      `./ink new acme 'Client credentials'`,
    ].join('\n');

    return Html.el('details', {}, [
      Html.el('summary', {}, 'Use it from a terminal'),
      Html.p('One POSIX shell script over the same API. It needs curl, age, tar and jq.', {
        class: 'hint',
      }),
      Html.el('pre', {}, install),
      Html.el('p', { class: 'hint' }, [
        'Then ',
        Html.el('code', {}, 'ink --help'),
        ' for the rest: send, list, read, export, rotate, destroy.',
      ]),
    ]);
  }

  private static footer(): Html {
    return Html.el('footer', {}, [
      Html.el('a', { href: Site.SOURCE }, 'Source'),
      Html.el('a', { href: `${Site.SOURCE}#readme` }, 'How it works'),
      Html.el('a', { href: Site.AGE, rel: 'noreferrer' }, 'age'),
    ]);
  }

  /** An inbox that asks for nothing in particular gets one free-text box. */
  private static single(): Html[] {
    return [
      Html.label('secret', 'Secret'),
      Html.textarea({ id: 'secret', spellcheck: 'false', autocomplete: 'off' }),
    ];
  }

  /** One control per thing the inbox asks for, named by the owner's label. */
  private static field(field: Field.View): Html {
    const id = `f-${field.key}`;
    const label = field.required ? `${field.label} (required)` : field.label;

    if (field.kind === 'multiline') {
      return Html.el('div', {}, [
        Html.label(id, label),
        Html.textarea({ id, spellcheck: 'false', autocomplete: 'off' }),
      ]);
    }

    const type = field.kind === 'file' ? 'file' : field.kind === 'secret' ? 'password' : 'text';
    return Html.el('div', {}, [
      Html.label(id, label),
      Html.input({ id, type, autocomplete: 'off', spellcheck: 'false' }),
    ]);
  }

  /** A native select. The browser already draws one better than we would. */
  private static select(id: string, options: readonly Site.Choice[]): Html {
    return Html.select(
      { id },
      options.map((option, at) => Html.option({ value: option.value, selected: at === 0 }, option.label)),
    );
  }
}

export namespace Site {
  export interface Choice {
    readonly value: string;
    readonly label: string;
  }
}
