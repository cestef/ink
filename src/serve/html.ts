/**
 * A typed element tree. Text and attribute values are escaped when a node is
 * built, so a page cannot forget to escape: the only way to emit unescaped
 * markup is `Html.raw`, which is greppable.
 */
export class Html {
  static readonly DOCTYPE = '<!doctype html>';
  static readonly VOID = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'source',
    'track',
    'wbr',
  ]);

  private constructor(private readonly markup: string) {}

  static raw(markup: string): Html {
    return new Html(markup);
  }

  static text(value: string): Html {
    return new Html(Html.escape(value));
  }

  static el(tag: string, attrs: Html.Attrs = {}, children: Html.Child = []): Html {
    const open = `<${tag}${Html.attrs(attrs)}>`;
    if (Html.VOID.has(tag)) return new Html(open);
    return new Html(`${open}${Html.render(children)}</${tag}>`);
  }

  static document(head: Html.Child, body: Html.Child, lang: string): Html {
    return new Html(
      `${Html.DOCTYPE}${Html.el('html', { lang }, [Html.el('head', {}, head), Html.el('body', {}, body)])}`,
    );
  }

  static h1(children: Html.Child, attrs: Html.Attrs = {}): Html {
    return Html.el('h1', attrs, children);
  }

  static p(children: Html.Child, attrs: Html.Attrs = {}): Html {
    return Html.el('p', attrs, children);
  }

  static div(attrs: Html.Attrs, children: Html.Child = []): Html {
    return Html.el('div', attrs, children);
  }

  static label(target: string, children: Html.Child): Html {
    return Html.el('label', { for: target }, children);
  }

  static input(attrs: Html.Attrs): Html {
    return Html.el('input', attrs);
  }

  static textarea(attrs: Html.Attrs): Html {
    return Html.el('textarea', attrs, '');
  }

  static button(attrs: Html.Attrs, children: Html.Child): Html {
    return Html.el('button', { type: 'button', ...attrs }, children);
  }

  static ul(attrs: Html.Attrs, children: Html.Child = []): Html {
    return Html.el('ul', attrs, children);
  }

  static select(attrs: Html.Attrs, children: Html.Child = []): Html {
    return Html.el('select', attrs, children);
  }

  static option(attrs: Html.Attrs, children: Html.Child): Html {
    return Html.el('option', attrs, children);
  }

  static title(value: string): Html {
    return Html.el('title', {}, value);
  }

  static meta(attrs: Html.Attrs): Html {
    return Html.el('meta', attrs);
  }

  static style(css: string): Html {
    return Html.el('style', {}, Html.raw(css));
  }

  static script(attrs: Html.Attrs): Html {
    return Html.el('script', attrs, '');
  }

  static escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) => Html.ENTITIES[c] ?? c);
  }

  toString(): string {
    return this.markup;
  }

  private static readonly ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  private static render(child: Html.Child): string {
    if (child === null || child === undefined || child === false) return '';
    if (child instanceof Html) return child.markup;
    if (Array.isArray(child)) return child.map((c) => Html.render(c)).join('');
    return Html.escape(String(child));
  }

  private static attrs(attrs: Html.Attrs): string {
    let out = '';
    for (const [name, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue;
      if (name === 'data') {
        for (const [key, item] of Object.entries(value as Record<string, string>)) {
          out += ` data-${key}="${Html.escape(item)}"`;
        }
        continue;
      }
      out += value === true ? ` ${name}` : ` ${name}="${Html.escape(String(value))}"`;
    }
    return out;
  }
}

export namespace Html {
  export type Child = Html | string | number | boolean | null | undefined | Html.Child[];

  export type Attrs = Record<string, string | number | boolean | Record<string, string> | undefined>;
}
