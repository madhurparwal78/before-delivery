const TOKEN_KEY = "lastbell.rejoinToken";

export const rememberSeat = (rejoinToken: string): void => localStorage.setItem(TOKEN_KEY, rejoinToken);
export const storedRejoinToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const forgetSeat = (): void => localStorage.removeItem(TOKEN_KEY);
