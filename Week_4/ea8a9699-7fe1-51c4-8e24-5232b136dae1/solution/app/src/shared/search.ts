// The search text rule (brief: API > Field messages, q): 1 to 100 characters.
export const Q_MAX = 100;
export const Q_MESSAGE = "Enter 1 to 100 characters.";
export const queryLength = (value: string): number => [...value].length;
