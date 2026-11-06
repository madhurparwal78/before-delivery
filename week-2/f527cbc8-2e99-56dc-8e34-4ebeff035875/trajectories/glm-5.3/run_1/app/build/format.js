import { money, moneySigned } from './format-helpers.js';
export { money, moneySigned };
export const HOOF_NAMES = { LF: 'Left fore', RF: 'Right fore', LH: 'Left hind', RH: 'Right hind' };
export const SERVICE_NAMES = {
    trim: 'Trim',
    front_reset: 'Front shoes, reset',
    full_reset: 'Full set, reset',
    front_new: 'Front shoes, new',
    full_new: 'Full set, new'
};
export const SERVICE_CODES = ['trim', 'front_reset', 'full_reset', 'front_new', 'full_new'];
export const CARD_LABELS = {
    tok_approve_4242: 'Test card 4242 (approves)',
    tok_decline_0002: 'Test card 0002 (declines)',
    tok_funds_9995: 'Test card 9995 (insufficient funds)'
};
