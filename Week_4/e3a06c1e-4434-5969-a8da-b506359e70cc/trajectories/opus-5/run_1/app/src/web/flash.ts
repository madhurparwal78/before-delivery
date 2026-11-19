let pending: string | null = null;

/** Carries one announcement across a console navigation, such as "Project created". */
export const setFlash = (message: string): void => {
  pending = message;
};

export const takeFlash = (): string | null => {
  const message = pending;
  pending = null;
  return message;
};
