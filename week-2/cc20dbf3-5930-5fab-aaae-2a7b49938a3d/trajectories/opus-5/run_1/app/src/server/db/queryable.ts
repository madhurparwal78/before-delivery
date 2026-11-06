import type { QueryResult, QueryResultRow } from 'pg';

/** Either the pool or a transaction's client; every query helper takes one. */
export interface Queryable {
  query<R extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
}
