import { Route } from './route.ts';

/** Every path this product has, named once. */
export namespace Routes {
  export const page = {
    home: Route.of('/'),
    inbox: Route.of('/i/:slug'),
    manage: Route.of('/i/:slug/manage'),
  } as const;

  /**
   * The same endpoints as `api`, addressed on the inbox's own host, where the
   * slug is the hostname and must not also be in the path.
   *
   * Every entry here has a counterpart in `api`, and `Tenant.rewrite` turns one
   * into the other. A browser on `acme.uses.ink` has to use these: asking for
   * the path form would get the inbox spliced in a second time.
   */
  export const site = {
    submit: Route.of('/'),
    manage: Route.of('/manage'),
    inbox: Route.of('/api'),
    token: Route.of('/api/token'),
    state: Route.of('/api/state'),
    key: Route.of('/api/key'),
    wrapping: Route.of('/api/key/:id'),
    submissions: Route.of('/api/submission'),
    submission: Route.of('/api/submission/:id'),
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
