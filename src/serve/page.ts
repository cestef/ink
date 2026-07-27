import { Cache } from './cache.ts';
import { Html } from './html.ts';
import manifest from './manifest.json' with { type: 'json' };

/**
 * The HTML shell. Every page is a heading, a form and one hash-pinned script:
 * the surface a stranger loads has to stay small enough that somebody can
 * actually read it, which is the only honest answer to "you serve the JS".
 */
export class Page {
  static readonly LANG = 'en';
  static readonly TYPE = 'text/html; charset=utf-8';
  static readonly ALG = 'SHA-256';

  /**
   * Native HTML, and only the rules it takes to be usable: a measure, some
   * spacing, and fixed-width for the things that actually are fixed-width.
   * Controls are left as the browser draws them, which is how they stay
   * familiar, accessible and correct on every platform without being asked to.
   */
  static readonly STYLE = `
    :root { color-scheme: light dark; }

    main { max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.3rem; margin: .2rem 0 .4rem; overflow-wrap: anywhere; }
    .mark, .sub, .hint, .meta { font-size: .9rem; opacity: .7; }
    .sub, .hint, .meta { margin: .3rem 0 0; }

    label, .label { display: block; margin-top: 1.2rem; }

    /* Native controls, given a consistent box and a visible focus ring. */
    input, select, textarea, button {
      font: inherit; color: inherit; background: transparent;
      border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
      border-radius: 4px; padding: .45rem .55rem;
    }
    input:not([type=checkbox]), select, textarea {
      display: block; width: 100%; max-width: 100%; margin-top: .25rem;
    }
    input:hover, select:hover, textarea:hover, button:hover:not(:disabled) {
      border-color: color-mix(in srgb, currentColor 60%, transparent);
    }
    :focus-visible { outline: 2px solid; outline-offset: 1px; }
    button { padding: .45rem .9rem; cursor: pointer; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    select { padding-right: .3rem; }
    textarea { min-height: 7rem; }
    .check { display: flex; gap: .5rem; align-items: baseline; margin-top: 1.2rem; }
    .check input { width: auto; margin: 0; }
    .check em { display: block; font-style: normal; font-size: .9rem; opacity: .7; }

    .actions { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin-top: 1.2rem; }
    .actions .check { margin: 0; }

    /* In a row the children share the width, so nothing inherits width:100%
       and squeezes its neighbour to nothing. */
    .row { display: flex; gap: .5rem; align-items: center; }
    .row > input, .row > select, .row > textarea { flex: 1 1 0; min-width: 0; width: auto; margin-top: 0; }
    .row > input[type=text] { flex: 2 1 0; }
    .row > button { flex: none; }

    /* Keys and ciphertext are fixed-width because they are, not for effect. */
    pre { font-size: .85rem; overflow-x: auto; white-space: pre-wrap; word-break: break-all;
          border: 1px solid; padding: .5rem; margin: .25rem 0 0; }
    .field { margin-top: 1.2rem; }

    /* Vertical padding, not just the left inset: it also stops child margins
       collapsing out of the block, so anything inside keeps its own gap. */
    .warn, .diag { border-left: 3px solid; padding: .5rem 0 .5rem .75rem; margin: 1.2rem 0 0; }
    .warn > p { margin: 0; }
    .warn > button, .warn > a { display: inline-block; margin-top: .75rem; }
    /* Whatever follows a warning gets air. A pre sets a tight top margin for
       sitting under a label, which reads as touching when it follows a block. */
    .warn + * { margin-top: .75rem; }
    .diag strong { display: block; }
    /* Only the lines inside a diagnostic tighten up. Listing .warn here too
       reset the margin above, which is a rule cancelling the one before it. */
    .diag p { margin: .2rem 0 0; }

    /* Label left, value right, on one grid so values line up down the column
       and a row is read across rather than parsed out of a sentence. */
    .facts { display: grid; grid-template-columns: auto 1fr; gap: .2rem .75rem;
             margin: .6rem 0 0; font-size: .9rem; }
    .facts dt { opacity: .7; }
    .facts dd { margin: 0; overflow-wrap: anywhere; }

    ul { list-style: none; padding: 0; margin-top: 1.2rem; }
    li { border-top: 1px solid; padding: .75rem 0; }
    /* Inside a row the parts belong to each other, so they sit closer than
       blocks on the page do. */
    li .field, li .actions, .field .actions { margin-top: .5rem; }
    details { margin-top: 2rem; }

    footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid; font-size: .85rem; }
    footer a { margin-right: 1rem; }

    .out:empty { display: none; }
    [hidden] { display: none !important; }
  `;

  /**
   * The stylesheet is pinned by hash rather than allowed with 'unsafe-inline',
   * so the policy permits exactly the bytes this file ships and nothing else.
   * Computed once per isolate: `STYLE` is a constant.
   */
  private static policy: Promise<string> | null = null;

  static csp(): Promise<string> {
    Page.policy ??= Page.build();
    return Page.policy;
  }

  private static async build(): Promise<string> {
    const bytes = new TextEncoder().encode(Page.STYLE);
    const digest = await crypto.subtle.digest(Page.ALG, bytes);
    const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
    return [
      "default-src 'none'",
      "script-src 'self'",
      `style-src 'sha256-${hash}'`,
      "connect-src 'self'",
      "img-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      // default-src does not cover framing, and this is the page where a
      // stranger types a credential. Without it, overlay attacks are trivial.
      "frame-ancestors 'none'",
    ].join('; ');
  }

  static async render(options: Page.Options): Promise<Response> {
    const asset = manifest[options.entry];
    const csp = await Page.csp();
    const document = Html.document(
      [
        Html.meta({ charset: 'utf-8' }),
        Html.meta({ name: 'viewport', content: 'width=device-width, initial-scale=1' }),
        Html.meta({ 'http-equiv': 'Content-Security-Policy', content: csp }),
        Html.title(options.title),
        Html.style(Page.STYLE),
      ],
      [
        Html.el('main', {}, [
          Html.div({ class: 'mark' }, options.mark ?? 'ink'),
          Html.h1(options.heading),
          options.sub === null ? null : Html.p(options.sub, { class: 'sub' }),
          options.body,
        ]),
        Html.script({
          type: 'module',
          src: asset.file,
          integrity: asset.integrity,
          crossorigin: 'anonymous',
        }),
      ],
      Page.LANG,
    );

    return new Response(document.toString(), {
      headers: {
        'content-type': Page.TYPE,
        'content-security-policy': csp,
        // For anything too old to honour frame-ancestors.
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        [Cache.HEADER]: Cache.PAGE,
      },
    });
  }
}

export namespace Page {
  export type Entry = keyof typeof manifest;

  export interface Options {
    readonly entry: Page.Entry;
    readonly title: string;
    readonly heading: string;
    /** Null when the page has nothing fixed to say and fills it in itself. */
    readonly sub: string | null;
    readonly body: Html.Child;
    /** The eyebrow above the heading. Defaults to the product name. */
    readonly mark?: string;
  }
}
