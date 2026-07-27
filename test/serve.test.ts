import { describe, expect, test } from 'bun:test';
import { Routes } from '../src/core/routes.ts';
import { Cache } from '../src/serve/cache.ts';
import { Page } from '../src/serve/page.ts';
import { World } from './harness/world.ts';

describe('caching', () => {
  test('pages are private and revalidated, never stored by a shared cache', async () => {
    const world = await World.make();
    const response = await world.fetch(Routes.page.home, undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get(Cache.HEADER)).toBe(Cache.PAGE);
  });

  test('api answers are never stored at all', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'caching', title: 't', passphrase: 'correct-horse-battery' });
    const response = await owner.listed();
    expect(response.headers.get(Cache.HEADER)).toBe(Cache.NONE);
  });

  test('a refusal is sealed the same way as an answer', async () => {
    const world = await World.make();
    const response = await world.fetch(Routes.page.inbox, { slug: 'absent' });
    expect(response.status).toBe(404);
    expect(response.headers.get(Cache.HEADER)).toBe(Cache.NONE);
  });
});

describe('pages', () => {
  test('the shell pins the bundle with an integrity hash', async () => {
    const world = await World.make();
    const html = await (await world.fetch(Routes.page.home, undefined)).text();
    expect(html).toContain('integrity="sha384-');
    expect(html).toContain('crossorigin="anonymous"');
  });

  test('the content security policy forbids inline and third party script', async () => {
    const world = await World.make();
    const response = await world.fetch(Routes.page.home, undefined);
    const csp = await Page.csp();

    expect(response.headers.get('content-security-policy')).toBe(csp);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  test('the page a stranger types secrets into cannot be framed', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'framing', title: 't', passphrase: 'correct-horse-battery' });
    const csp = await Page.csp();

    // default-src 'none' does not cover framing, so this must be explicit.
    expect(csp).toContain("frame-ancestors 'none'");

    for (const page of [
      await world.fetch(Routes.page.home, undefined),
      await world.fetch(Routes.page.inbox, { slug: owner.slug }),
      await world.fetch(Routes.page.manage, { slug: owner.slug }),
    ]) {
      expect(page.headers.get('x-frame-options')).toBe('DENY');
      expect(page.headers.get('referrer-policy')).toBe('no-referrer');
      expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  test('inline styles are pinned by hash, not allowed wholesale', async () => {
    const csp = await Page.csp();
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/);

    // The hash must cover exactly the bytes the page ships, or styling breaks.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(Page.STYLE));
    const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
    expect(csp).toContain(`style-src 'sha256-${hash}'`);

    const world = await World.make();
    const html = await (await world.fetch(Routes.page.home, undefined)).text();
    expect(html).toContain(`<style>${Page.STYLE}</style>`);
  });

  test('the submit page carries the recipient for the stripped-fragment warning', async () => {
    const world = await World.make();
    const owner = await world.open({ slug: 'pages', title: 'send me a key', passphrase: 'correct-horse' });
    const html = await (await world.fetch(Routes.page.inbox, { slug: owner.slug })).text();
    expect(html).toContain(`data-recipient="${owner.recipient}"`);
    expect(html).toContain('send me a key');
  });

  test('a page for an inbox that does not exist is a diagnostic, not a crash', async () => {
    const world = await World.make();
    const response = await world.fetch(Routes.page.inbox, { slug: 'absent' });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; help?: string[] } };
    expect(body.error.code).toBe('inbox.missing');
    expect(body.error.help?.length).toBeGreaterThan(0);
  });
});

describe('routing', () => {
  test('an unmounted path names what is mounted', async () => {
    const world = await World.make();
    const response = await world.app.fetch(new Request(`${World.ORIGIN}/nope`));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; help?: string[] } };
    expect(body.error.code).toBe('route.missing');
    expect(body.error.help?.[0]).toContain('/api/inbox');
  });

  test('HEAD answers as GET does, headers and all, with no body', async () => {
    const world = await World.make();
    const get = await world.fetch(Routes.page.home, undefined);
    const head = await world.fetch(Routes.page.home, undefined, { method: 'HEAD' });

    expect(head.status).toBe(get.status);
    expect(head.headers.get('content-security-policy')).toBe(get.headers.get('content-security-policy'));
    expect(head.headers.get(Cache.HEADER)).toBe(get.headers.get(Cache.HEADER));
    expect(await head.text()).toBe('');
    expect((await get.text()).length).toBeGreaterThan(0);
  });

  test('the wrong method on a real path is still a clean refusal', async () => {
    const world = await World.make();
    const response = await world.fetch(Routes.api.create, undefined, { method: 'GET' });
    expect(response.status).toBe(404);
  });
});
