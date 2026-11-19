const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmailAddress = (text: string): boolean => EMAIL_ADDRESS.test(text);
