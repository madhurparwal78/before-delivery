/** The rules an account's fields must meet, decided once for the sign-up form and the sign-up endpoint. */
const NAME_MAX = 120;
const PASSWORD_MIN = 8;

export const validName = (name: string): boolean => name.trim().length >= 1 && name.trim().length <= NAME_MAX;
export const validMobile = (mobile: string): boolean => /^[6-9]\d{9}$/.test(mobile);
export const validPassword = (password: string): boolean => password.length >= PASSWORD_MIN;
