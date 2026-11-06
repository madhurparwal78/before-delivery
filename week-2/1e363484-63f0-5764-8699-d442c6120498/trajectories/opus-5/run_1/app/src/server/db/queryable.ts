import type { QueryResult, QueryResultRow } from 'pg';

/** Anything that can run a query: the pool or a client inside a transaction. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}
