import { Code, Diag, Span } from './diag/index.ts';

/**
 * A path template that knows its own parameters. Both planes read the same
 * `Route`: the server mounts `template`, the browser calls `path`, so a route
 * cannot be spelled one way in a handler and another in a link.
 */
export class Route<S extends string> {
  static readonly MARK = ':';
  static readonly PARAM = /:([A-Za-z][A-Za-z0-9]*)/g;

  private constructor(readonly template: S) {}

  static of<S extends string>(template: S): Route<S> {
    return new Route(template);
  }

  path(params: Route.Args<S>): string {
    const values = (params ?? {}) as Record<string, string>;
    return this.template.replace(Route.PARAM, (_, name: string) => {
      const value = values[name];
      if (value === undefined) throw Route.absent(this.template, name);
      return encodeURIComponent(value);
    });
  }

  private static absent(template: string, name: string): Diag {
    const at = template.indexOf(`${Route.MARK}${name}`);
    return Diag.of(Code.ROUTE_PARAM, `route is missing the "${name}" parameter`)
      .withSource(template, new Span(at, name.length + Route.MARK.length, 'never supplied'))
      .withHelp('every parameter in the template must be passed to path() or url()');
  }

  url(base: string | URL, params: Route.Args<S>, fragment?: string): string {
    const url = new URL(this.path(params), base);
    if (fragment) url.hash = fragment;
    return url.toString();
  }

  toString(): string {
    return this.template;
  }
}

export namespace Route {
  export type Names<S extends string> = S extends `${string}:${infer Rest}`
    ? Rest extends `${infer Name}/${infer Tail}`
      ? Name | Route.Names<`/${Tail}`>
      : Rest
    : never;

  export type Args<S extends string> = [Route.Names<S>] extends [never]
    ? void
    : Record<Route.Names<S>, string>;
}
