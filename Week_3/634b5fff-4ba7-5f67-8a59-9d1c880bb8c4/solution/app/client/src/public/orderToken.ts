const key = (reference: string): string => `press.order.${reference}`;

/** Remembers an order's token for the browser session, so the page survives a reload without `?token=`. */
export const rememberOrderToken = (reference: string, token: string): void => sessionStorage.setItem(key(reference), token);

export const orderToken = (reference: string): string | null => sessionStorage.getItem(key(reference));

/** The address of an order page, token included. */
export const orderPath = (reference: string, token: string): string => `/order/${reference}?token=${encodeURIComponent(token)}`;
