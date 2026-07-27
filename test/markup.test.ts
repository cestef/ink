import { describe, expect, test } from 'bun:test';
import { Routes } from '../src/core/routes.ts';
import { World } from './harness/world.ts';

/**
 * The client addresses everything by id, so a duplicate silently hands it the
 * wrong element. That shipped once already: a passphrase checkbox and the
 * passphrase field shared an id, and reading the field returned the checkbox.
 */
class Markup {
  static ids(html: string): string[] {
    return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
  }

  static labels(html: string): string[] {
    return [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((match) => match[1]!);
  }
}

describe('page markup', () => {
  const pages = async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'markup', title: 'Client keys', passphrase: 'correct-horse-b' });
    return {
      create: await (await world.fetch(Routes.page.home, undefined)).text(),
      submit: await (await world.fetch(Routes.page.inbox, { slug: owner.slug })).text(),
      manage: await (await world.fetch(Routes.page.manage, { slug: owner.slug })).text(),
    };
  };

  test('every id on every page is unique', async () => {
    for (const [name, html] of Object.entries(await pages())) {
      const ids = Markup.ids(html);
      const duplicated = ids.filter((id, at) => ids.indexOf(id) !== at);
      expect({ [name]: duplicated }).toEqual({ [name]: [] });
    }
  });

  test('every label points at an element that exists', async () => {
    for (const [name, html] of Object.entries(await pages())) {
      const ids = new Set(Markup.ids(html));
      const orphans = Markup.labels(html).filter((target) => !ids.has(target));
      expect({ [name]: orphans }).toEqual({ [name]: [] });
    }
  });

  test('the pages carry the elements the client reaches for', async () => {
    const { create, submit, manage } = await pages();

    const carries = [
      [
        'create',
        create,
        [
          'slug',
          'title',
          'method',
          'passphrase-field',
          'passphrase',
          'suggest',
          'retain',
          'burn',
          'create',
          'out',
          'kind',
          'kind-note',
          'method-note',
        ],
      ],
      ['submit', submit, ['root', 'secret', 'send', 'warn', 'out', 'bypass']],
      // The manage page has no unlock control until it knows how the inbox opens.
      ['manage', manage, ['root', 'unlock', 'out', 'list']],
    ] as const;

    for (const [name, html, ids] of carries) {
      const missing = ids.filter((id) => !html.includes(`id="${id}"`));
      expect({ [name]: missing }).toEqual({ [name]: [] });
    }
  });

  test('the passphrase field starts hidden, so one method is asked for at a time', async () => {
    const { create } = await pages();
    expect(create).toContain('<div id="passphrase-field" hidden>');
  });

  test('the manage page ships no passphrase box until it knows it needs one', async () => {
    const { manage } = await pages();
    expect(manage).not.toContain('type="password"');
    expect(manage).toContain('id="unlock"');
  });

  /**
   * The script is the escape hatch from trusting this page, so a page that
   * never mentions it leaves the only trustless route undiscoverable.
   */
  test('the home page says the terminal route exists and where to get it', async () => {
    const world = await World.make('ink.test');
    const create = await (await world.fetch(Routes.page.home, undefined)).text();

    expect(create).toContain('Use it from a terminal');
    // The install URL follows the domain the server is actually serving, so a
    // deployment somewhere else does not hand out a link to production.
    expect(create).toContain('curl -fsSL https://ink.test/ink -o ink');
    expect(create).toContain('<code>ink --help</code>');
  });

  test('the home page links to the source it asks people to trust', async () => {
    const { create } = await pages();
    for (const href of ['https://github.com/cestef/ink', 'https://age-encryption.org']) {
      expect({ href, present: create.includes(`href="${href}"`) }).toEqual({ href, present: true });
    }
  });

  test('the key type control is a native select, so it stays keyboard usable', async () => {
    const { create } = await pages();
    expect(create).toContain('<select id="kind">');
    expect(create).toContain('<option value="x25519" selected>');
    expect(create).toContain('<option value="hybrid">');
  });
});
