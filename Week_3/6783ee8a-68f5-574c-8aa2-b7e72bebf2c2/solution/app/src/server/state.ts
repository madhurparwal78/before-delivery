let databaseReady = false;

/** True once PostgreSQL answered and the schema is applied; health reports "starting" until then. */
export const ready = (): boolean => databaseReady;
export const markReady = (): void => {
  databaseReady = true;
};
