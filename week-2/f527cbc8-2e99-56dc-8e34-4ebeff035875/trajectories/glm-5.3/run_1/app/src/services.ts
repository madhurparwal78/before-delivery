export const SERVICE_NAMES: Record<string, string> = {
  trim: 'Trim',
  front_reset: 'Front shoes, reset',
  full_reset: 'Full set, reset',
  front_new: 'Front shoes, new',
  full_new: 'Full set, new'
};

export const SERVICE_CODES = ['trim', 'front_reset', 'full_reset', 'front_new', 'full_new'] as const;
export type ServiceCode = typeof SERVICE_CODES[number];
