import { describe, expect, test } from 'bun:test';
import { Host } from '../src/core/host.ts';
import type { Route } from '../src/core/route.ts';
import { Routes } from '../src/core/routes.ts';
import { Slug } from '../src/core/slug.ts';
import { Tenant } from '../src/serve/tenant.ts';
import { World } from './harness/world.ts';

const PASS = 'correct-horse-battery';
const DOMAIN = 'ink.test';

describe('host resolution', () => {
  test('reads the inbox from the label under the domain', () => {
    expect(Host.of('acme.ink.test', DOMAIN).kind).toBe('inbox');
    expect(Host.of('acme.ink.test', DOMAIN).slug).toBe('acme');
    expect(Host.of('ACME.INK.TEST:8787', DOMAIN).slug).toBe('acme');
  });

  test('the apex and www are where inboxes are made, not read', () => {
    expect(Host.of('ink.test', DOMAIN).kind).toBe('apex');
    expect(Host.of('www.ink.test', DOMAIN).kind).toBe('apex');
  });

  test('anything not under the domain falls back to paths', () => {
    expect(Host.of('localhost', DOMAIN).kind).toBe('paths');
    expect(Host.of('127.0.0.1', DOMAIN).kind).toBe('paths');
    expect(Host.of('ink.test.evil.com', DOMAIN).kind).toBe('paths');
    expect(Host.of('acme.ink.test', null).kind).toBe('paths');
  });

  test('a deeper name is not an inbox, so a.b.ink.test never resolves to a', () => {
    expect(Host.of('a.b.ink.test', DOMAIN).kind).toBe('paths');
  });

  test('a label that could not be a slug is not treated as one', () => {
    expect(Host.of('-bad.ink.test', DOMAIN).kind).toBe('paths');
    expect(Host.of('ab.ink.test', DOMAIN).kind).toBe('paths');
  });
});

describe('rewriting', () => {
  const tenant = new Tenant(DOMAIN);
  const at = (url: string) => tenant.rewrite(new URL(url)).pathname;

  test('pages map onto the path routes already served', () => {
    expect(at('https://acme.ink.test/')).toBe('/i/acme');
    expect(at('https://acme.ink.test/manage')).toBe('/i/acme/manage');
  });

  test('the api maps under the inbox it belongs to', () => {
    expect(at('https://acme.ink.test/api/submission')).toBe('/api/inbox/acme/submission');
    expect(at('https://acme.ink.test/api/submission/ab12')).toBe('/api/inbox/acme/submission/ab12');
    expect(at('https://acme.ink.test/api/key')).toBe('/api/inbox/acme/key');
    expect(at('https://acme.ink.test/api/token')).toBe('/api/inbox/acme/token');
  });

  test('the apex and unknown hosts are left alone', () => {
    expect(at('https://ink.test/')).toBe('/');
    expect(at('https://ink.test/api/inbox')).toBe('/api/inbox');
    expect(at('https://localhost:8787/i/acme')).toBe('/i/acme');
  });
});

/**
 * The two route tables have to stay twins. A browser on an inbox host that
 * reaches for the path form gets the inbox spliced in twice, which is how
 * `/api/inbox/hey/inbox/hey/key` reached production: every manage page on a
 * subdomain was broken, and nothing here compared the two tables.
 */
describe('the host form and the path form describe the same endpoints', () => {
  const tenant = new Tenant(DOMAIN);
  const rewrite = (path: string) => tenant.rewrite(new URL(`https://acme.${DOMAIN}${path}`)).pathname;
  const fill = <S extends string>(route: Route<S>) =>
    route.template.replace(/:slug/g, 'acme').replace(/:id/g, 'abc123');

  const twins = [
    ['inbox', Routes.site.inbox, Routes.api.inbox],
    ['token', Routes.site.token, Routes.api.token],
    ['state', Routes.site.state, Routes.api.state],
    ['key', Routes.site.key, Routes.api.key],
    ['wrapping', Routes.site.wrapping, Routes.api.wrapping],
    ['submissions', Routes.site.submissions, Routes.api.submissions],
    ['submission', Routes.site.submission, Routes.api.submission],
    ['submit', Routes.site.submit, Routes.page.inbox],
    ['manage', Routes.site.manage, Routes.page.manage],
  ] as const;

  for (const [name, host, path] of twins) {
    test(`${name} on a subdomain rewrites to its path form`, () => {
      expect({ [name]: rewrite(fill(host)) }).toEqual({ [name]: fill(path) });
    });
  }

  test('every api endpoint an inbox owns has a host form', () => {
    const owned = Object.entries(Routes.api).filter(([, route]) => route.template.includes(':slug'));
    const missing = owned.filter(([name]) => !(name in Routes.site));
    expect(missing.map(([name]) => name)).toEqual([]);
  });
});

describe('serving an inbox on its own host', () => {
  test('the whole flow works by subdomain, and by path at the same time', async () => {
    const world = await World.make(DOMAIN);
    const owner = await world.open({ slug: 'acme', title: 'Client keys', passphrase: PASS });

    // The submit page, addressed as a stranger would reach it.
    const page = await world.at('acme', '/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Client keys');

    // The API, on the same host, with no slug in the path.
    const submitted = await world.at('acme', '/api/submission', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(32),
    });
    expect(submitted.status).toBe(201);

    const listed = await world.at('acme', '/api/submission', {
      headers: { 'x-ink-token': owner.token },
    });
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { submissions: unknown[] }).submissions.length).toBe(1);

    // The path form still answers, so nothing had to move.
    expect((await world.fetch(Routes.page.inbox, { slug: 'acme' })).status).toBe(200);
  });

  test('the apex serves the create page, not an inbox', async () => {
    const world = await World.make(DOMAIN);
    const response = await world.app.fetch(new Request(`https://${DOMAIN}/`));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Ask for a secret');
  });

  test('an unknown subdomain is a clean refusal', async () => {
    const world = await World.make(DOMAIN);
    const response = await world.at('nobody', '/');
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('inbox.missing');
  });
});

describe('reserved labels', () => {
  test('names that would shadow infrastructure are refused', () => {
    for (const name of ['www', 'api', 'mail', 'ns1', 'smtp', 'admin', 'status']) {
      expect({ [name]: () => Slug.parse(name) }[name]).toThrow();
    }
  });

  test('an ordinary name is still fine', () => {
    expect(Slug.parse('acme').value).toBe('acme');
  });
});
