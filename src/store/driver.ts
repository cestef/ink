/**
 * The whole surface a host must supply. D1 and `bun:sqlite` both speak SQL with
 * positional parameters, so keeping this narrow is what lets one set of queries
 * serve both without an ORM in between.
 */
export interface Driver {
  run(sql: string, params?: readonly Driver.Param[]): Promise<void>;
  all<T>(sql: string, params?: readonly Driver.Param[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly Driver.Param[]): Promise<T | null>;
}

export namespace Driver {
  export type Param = string | number | null;
}
