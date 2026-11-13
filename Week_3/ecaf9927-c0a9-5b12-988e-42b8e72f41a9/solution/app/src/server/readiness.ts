let ready = false;

/** Health answers 200 only once the schema is applied, the seed exists and the seeded bodies have been written. */
export const isReady = (): boolean => ready;

export const markReady = (): void => {
  ready = true;
};
