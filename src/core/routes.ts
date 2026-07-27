import { Route } from './route.ts';

/** Every path this product has, named once. */
export namespace Routes {
  export const page = {
    home: Route.of('/'),
    inbox: Route.of('/i/:slug'),
    manage: Route.of('/i/:slug/manage'),
  } as const;

  /** The same pages, addressed by subdomain instead of by path. */
  export const site = {
    submit: Route.of('/'),
    manage: Route.of('/manage'),
    submissions: Route.of('/api/submission'),
  } as const;

  export const api = {
    create: Route.of('/api/inbox'),
    // Mounted for DELETE only, behind the manage token. There is deliberately
    // no unauthenticated GET: the submit page already carries what a sender
    // needs, so a second way to read it would only be cheaper enumeration.
    inbox: Route.of('/api/inbox/:slug'),
    token: Route.of('/api/inbox/:slug/token'),
    state: Route.of('/api/inbox/:slug/state'),
    key: Route.of('/api/inbox/:slug/key'),
    wrapping: Route.of('/api/inbox/:slug/key/:id'),
    submissions: Route.of('/api/inbox/:slug/submission'),
    submission: Route.of('/api/inbox/:slug/submission/:id'),
  } as const;
}
