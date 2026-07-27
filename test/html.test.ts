import { describe, expect, test } from 'bun:test';
import { Html } from '../src/serve/html.ts';

describe('html', () => {
  test('text children are escaped', () => {
    expect(Html.p('<script>alert(1)</script>').toString()).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  test('attribute values are escaped, so a quote cannot break out', () => {
    const markup = Html.input({ value: '" onfocus="alert(1)' }).toString();
    expect(markup).toBe('<input value="&quot; onfocus=&quot;alert(1)">');
  });

  test('data attributes are escaped too', () => {
    const markup = Html.div({ data: { slug: 'a"b' } }).toString();
    expect(markup).toBe('<div data-slug="a&quot;b"></div>');
  });

  test('boolean attributes render bare or vanish', () => {
    expect(Html.input({ required: true }).toString()).toBe('<input required>');
    expect(Html.input({ required: false }).toString()).toBe('<input>');
    expect(Html.input({ required: undefined }).toString()).toBe('<input>');
  });

  test('void elements never get a closing tag', () => {
    expect(Html.meta({ charset: 'utf-8' }).toString()).toBe('<meta charset="utf-8">');
  });

  test('raw is the only way through, and it is greppable', () => {
    expect(Html.raw('<b>bold</b>').toString()).toBe('<b>bold</b>');
    expect(Html.text('<b>bold</b>').toString()).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  test('children nest and flatten', () => {
    const markup = Html.div({ id: 'root' }, [
      Html.p('one'),
      [Html.p('two'), null, false],
      'three',
    ]).toString();
    expect(markup).toBe('<div id="root"><p>one</p><p>two</p>three</div>');
  });

  test('a document carries the doctype and lang', () => {
    const markup = Html.document(Html.title('t'), Html.p('body'), 'en').toString();
    expect(markup).toBe(
      '<!doctype html><html lang="en"><head><title>t</title></head><body><p>body</p></body></html>',
    );
  });
});
