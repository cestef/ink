import { describe, expect, test } from 'bun:test';
import { Code, Diag } from '../src/core/diag/index.ts';
import { Route } from '../src/core/route.ts';
import { Routes } from '../src/core/routes.ts';

describe('route', () => {
  test('a template with no parameters is callable with none', () => {
    expect(Routes.api.create.path()).toBe('/api/inbox');
  });

  test('parameters are substituted in order', () => {
    expect(Routes.api.submission.path({ slug: 'acme', id: 'abc' })).toBe('/api/inbox/acme/submission/abc');
  });

  test('parameter values are percent encoded, so a value cannot forge a segment', () => {
    expect(Routes.api.key.path({ slug: 'a/b' })).toBe('/api/inbox/a%2Fb/key');
    expect(Routes.api.key.path({ slug: 'a?b#c' })).toBe('/api/inbox/a%3Fb%23c/key');
  });

  test('no unauthenticated route exposes inbox metadata', () => {
    const open = [Routes.api.create.template, Routes.api.submissions.template];
    expect(open).not.toContain('/api/inbox/:slug');
  });

  test('url attaches a fragment without it reaching the path', () => {
    const url = Routes.page.inbox.url('https://ink.test', { slug: 'acme' }, 'age1xyz');
    expect(url).toBe('https://ink.test/i/acme#age1xyz');
    expect(new URL(url).pathname).toBe('/i/acme');
    expect(new URL(url).hash).toBe('#age1xyz');
  });

  test('a missing parameter is a diagnostic pointing at the template', () => {
    const route = Route.of('/api/inbox/:slug/submission/:id');
    let raised: Diag | null = null;
    try {
      route.path({ slug: 'acme' } as Route.Args<'/api/inbox/:slug/submission/:id'>);
    } catch (cause) {
      raised = cause as Diag;
    }

    expect(raised).toBeInstanceOf(Diag);
    expect(raised?.code).toBe(Code.ROUTE_PARAM);

    const plan = raised!.plan();
    expect(plan.marks[0]?.column).toBe('/api/inbox/:slug/submission/'.length);
    expect(plan.marks[0]?.width).toBe(':id'.length);
    expect(plan.marks[0]?.label).toBe('never supplied');
  });

  test('the table and the router agree on every template', () => {
    const all = [...Object.values(Routes.page), ...Object.values(Routes.api)];
    for (const route of all) {
      expect(route.template.startsWith('/')).toBe(true);
      expect(route.toString()).toBe(route.template);
    }
  });
});
