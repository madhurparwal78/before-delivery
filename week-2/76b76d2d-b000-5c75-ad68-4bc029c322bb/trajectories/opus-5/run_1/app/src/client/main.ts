import type { Locale } from '../shared/money.ts';
import { initChrome } from './chrome.ts';
import { applyTranslations } from './i18n.ts';
import { initStage, type StageSeason } from './stage.ts';
import { initSeatMap } from './screening.ts';
import { initCheckout } from './checkout.ts';
import {
  initBookingLink,
  initBookingPage,
  initContact,
  initGift,
  initGiftRedemption,
  initMembership,
  initSignin,
  initSignup,
} from './forms.ts';
import { initStaff } from './staff.ts';

type PageData = {
  locale: Locale;
  page: string;
  seasons?: StageSeason[];
  screening_id?: string;
  hold_id?: string;
  booking_ref?: string;
  token?: string | null;
  has_membership?: boolean;
  signed_in?: boolean;
  group?: boolean;
  seats?: string[];
  expires_at?: string;
  server_time?: string;
};

function readData(): PageData {
  const node = document.getElementById('page-data');
  if (node === null) return { locale: 'en', page: 'unknown' };
  return JSON.parse(node.textContent ?? '{}') as PageData;
}

function start(): void {
  const data = readData();
  initChrome(data.locale);
  applyTranslations();
  switch (data.page) {
    case 'programme':
      initStage(data.seasons ?? []);
      break;
    case 'screening':
      initSeatMap(data.screening_id ?? '');
      break;
    case 'checkout':
      initCheckout({
        hold_id: data.hold_id ?? '',
        screening_id: data.screening_id ?? '',
        group: data.group === true,
        seats: data.seats ?? [],
        expires_at: data.expires_at ?? new Date().toISOString(),
        server_time: data.server_time ?? new Date().toISOString(),
        signed_in: data.signed_in === true,
      });
      break;
    case 'booking':
      initBookingPage({ booking_ref: data.booking_ref ?? '', token: data.token ?? null });
      break;
    case 'membership':
      initMembership({ has_membership: data.has_membership === true });
      break;
    case 'gift':
      initGift({ signed_in: data.signed_in === true });
      break;
    case 'gift-redemption':
      initGiftRedemption({ token: data.token ?? '' });
      break;
    case 'signin':
      initSignin();
      break;
    case 'signup':
      initSignup();
      break;
    case 'booking-link':
      initBookingLink();
      break;
    case 'contact':
      initContact();
      break;
    case 'staff':
      initStaff();
      break;
    default:
      break;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
