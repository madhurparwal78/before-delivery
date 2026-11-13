import { Cur, PlanCode, Quote } from '../../shared/types';
import { roundDiv } from '../../shared/money';
import { sumLines } from '../../shared/lines';
import { api, failureOf } from '../api';
import { Route, frame, navigate, onEvent } from '../app';
import { clear, el, money } from '../dom';
import { amount, dayMonth, decimal1, m, t } from '../i18n';
import { state } from '../state';
import { spinbutton } from '../components/controls';
import { openDatePicker } from '../components/datepicker';
import { displayControls } from '../components/display';
import { openGallery } from '../components/gallery';
import { StripNight, nightStrip } from '../components/nightstrip';

interface PropertyInfo {
  code: string;
  name: string;
  zone: string;
  stars: number;
  amenities: string[];
  score: number;
  distance_km: number;
  pictures: string[];
  room_types: { code: string; name: string; max_adults: number; max_guests: number; left: number }[];
  recommendation: { rooms: { room_type: string; adults: number; ages: number[] }[]; total_minor: number } | null;
}

interface Selection {
  counts: Map<string, number>;
  plans: PlanCode[];
  breakfast: boolean[];
  rooms: { room_type: string; adults: number; ages: number[] }[];
}

export async function propertyPage(main: HTMLElement, route: Route): Promise<void> {
  const code = route.path.split('/')[2];
  const params = new URLSearchParams(route.query);
  const inDate = params.get('in') ?? '';
  const outDate = params.get('out') ?? '';
  const adults = Number(params.get('adults') ?? '2');
  const ages = (params.get('ages') ?? '')
    .split(',')
    .filter((part) => part !== '')
    .map(Number);
  const currency = (params.get('cur') ?? state.cur) as Cur;
  const display = (params.get('display') ?? 'total') as 'total' | 'night';
  const withTax = params.get('tax') !== '0';

  const query = new URLSearchParams({
    in: inDate,
    out: outDate,
    adults: String(adults),
    ages: ages.join(','),
    cur: currency,
  });
  let info: PropertyInfo;
  try {
    info = await api<PropertyInfo>(`/api/properties/${code}?${query.toString()}`);
  } catch (err) {
    const failure = failureOf(err);
    main.append(
      el('div', { class: 'empty' }, [
        el('p', { class: 'huge-word' }, [m('empty.results.word')]),
        el('p', {}, [m(failure?.status === 403 ? 'page.forbidden' : 'page.missing')]),
      ]),
    );
    return;
  }

  const header = el('div', { class: 'property-header' }, [
    el('h1', {}, [info.name]),
    el('p', {}, [`${info.stars} ★ · ${decimal1(info.score)} · ${decimal1(info.distance_km)} km`]),
  ]);

  const datesButton = el('button', { type: 'button', 'data-focus-key': 'property:dates' }, [
    inDate && outDate
      ? t('ui.dates_range', {
          in: dayMonth(inDate, info.zone),
          out: dayMonth(outDate, info.zone),
          count: Math.round((Date.parse(`${outDate}T00:00:00Z`) - Date.parse(`${inDate}T00:00:00Z`)) / 86400000),
        })
      : t('ui.dates'),
  ]);
  datesButton.addEventListener('click', () => {
    openDatePicker({
      source: { property: code, zone: info.zone, cur: currency },
      start: inDate,
      end: outDate,
      opener: datesButton,
      onPicked: (picked, pickedOut) => {
        const next = new URLSearchParams(params);
        next.set('in', picked);
        next.set('out', pickedOut);
        void navigate(`/properties/${code}?${next.toString()}`);
      },
    });
  });

  main.append(
    header,
    datesButton,
    displayControls(params, (next) => void navigate(`/properties/${code}?${next.toString()}`)),
  );

  if (!info.recommendation) {
    main.append(
      el('div', { class: 'empty' }, [
        el('p', { class: 'huge-word' }, [m('empty.sold.word')]),
        el('p', {}, [m('empty.sold')]),
      ]),
    );
    return;
  }

  const recommendedCounts = new Map<string, number>();
  for (const room of info.recommendation.rooms) {
    recommendedCounts.set(room.room_type, (recommendedCounts.get(room.room_type) ?? 0) + 1);
  }
  const selection: Selection = {
    counts: new Map(recommendedCounts),
    plans: info.recommendation.rooms.map(() => 'refundable'),
    breakfast: info.recommendation.rooms.map(() => false),
    rooms: info.recommendation.rooms.map((room) => ({ ...room })),
  };

  const roomsGroup = el('div', { role: 'group', 'aria-label': t('ui.rooms'), class: 'rooms' });
  const stripHolder = el('div', { class: 'strip-holder' });
  const priceRegion = el('div', {
    role: 'region',
    'aria-label': t('ui.price_and_reserve'),
    class: 'price-reserve',
  });
  const picturesButton = el('button', { type: 'button', 'data-focus-key': 'property:pictures' }, [
    t('ui.show_pictures'),
  ]);
  picturesButton.addEventListener('click', () => openGallery(info.pictures, picturesButton));

  main.append(roomsGroup, stripHolder, picturesButton, priceRegion);

  let quote: Quote | null = null;

  const isRecommended = (): boolean => {
    if (selection.counts.size !== recommendedCounts.size) return false;
    for (const [key, value] of recommendedCounts) if (selection.counts.get(key) !== value) return false;
    return true;
  };

  const paintRooms = (): void => {
    clear(roomsGroup);
    for (const rt of info.room_types) {
      roomsGroup.append(
        spinbutton({
          label: t('ui.room_spin', { name: rt.name }),
          min: 0,
          max: Math.max(rt.left, 0),
          value: selection.counts.get(rt.code) ?? 0,
          focusKey: `rooms:${rt.code}`,
          onChange: (value) => {
            const next = new Map(selection.counts);
            if (value > 0) next.set(rt.code, value);
            else next.delete(rt.code);
            void placeRooms(next);
          },
        }),
      );
    }
    if (isRecommended()) roomsGroup.append(el('span', { class: 'tag' }, [t('ui.recommended')]));
    const useRecommended = el('button', { type: 'button', 'data-focus-key': 'rooms:recommended' }, [
      t('ui.use_recommended'),
    ]);
    useRecommended.addEventListener('click', () => void placeRooms(new Map(recommendedCounts)));
    roomsGroup.append(useRecommended);

    selection.rooms.forEach((room, index) => {
      const group = el('div', { role: 'radiogroup', 'aria-label': t('ui.rate_for_room', { n: index + 1 }) });
      for (const plan of ['refundable', 'nonrefundable'] as PlanCode[]) {
        const radio = el(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': selection.plans[index] === plan ? 'true' : 'false',
            'data-focus-key': `plan:${index}:${plan}`,
          },
          [plan === 'refundable' ? t('ui.flexible') : t('ui.nonrefundable')],
        );
        radio.addEventListener('click', () => {
          selection.plans[index] = plan;
          void requote();
        });
        group.append(radio);
      }
      const breakfast = el(
        'button',
        {
          type: 'button',
          role: 'checkbox',
          'aria-checked': selection.breakfast[index] ? 'true' : 'false',
          'data-focus-key': `breakfast:${index}`,
        },
        [t('ui.breakfast_for_room', { n: index + 1 })],
      );
      breakfast.addEventListener('click', () => {
        selection.breakfast[index] = !selection.breakfast[index];
        void requote();
      });
      roomsGroup.append(group, breakfast);
      void room;
    });
  };

  const placeRooms = async (counts: Map<string, number>): Promise<void> => {
    roomsGroup.setAttribute('aria-busy', 'true');
    try {
      const placed = await api<{ rooms: { room_type: string; adults: number; ages: number[] }[] }>(
        '/api/allocations',
        {
          method: 'POST',
          body: {
            property: code,
            in: inDate,
            out: outDate,
            adults,
            ages,
            counts: Object.fromEntries(counts),
          },
        },
      );
      selection.counts = counts;
      selection.rooms = placed.rooms;
      selection.plans = placed.rooms.map((_, index) => selection.plans[index] ?? 'refundable');
      selection.breakfast = placed.rooms.map((_, index) => selection.breakfast[index] ?? false);
      frame.regions.roomAdvice.textContent = '';
      paintRooms();
      await requote();
    } catch (err) {
      const failure = failureOf(err);
      const advice = failure?.body.advice as { code: string; n: number; m?: number; room_type?: string } | undefined;
      if (advice) {
        const name = info.room_types.find((rt) => rt.code === advice.room_type)?.name ?? advice.room_type ?? '';
        frame.regions.roomAdvice.textContent = m(`advice.${advice.code}`, {
          n: advice.n,
          m: advice.m ?? 0,
          name,
        });
      }
      paintRooms();
    } finally {
      roomsGroup.removeAttribute('aria-busy');
    }
  };

  const paintPrice = (): void => {
    clear(priceRegion);
    clear(stripHolder);
    if (!quote) return;
    const nights = quote.nights.length;
    const totalMinor = withTax ? quote.converted_total_minor : quote.converted_taxable_minor;
    const shown = display === 'night' ? roundDiv(totalMinor, nights) : totalMinor;
    const text = amount(shown, quote.currency);
    const reserve = el('button', { type: 'button', 'data-focus-key': 'property:reserve' }, [t('ui.reserve')]);
    reserve.addEventListener('click', () => void reserveNow(reserve));
    priceRegion.append(money(shown, quote.currency, text, { class: 'total' }), reserve);

    const shownQuote = quote;
    const strip: StripNight[] = shownQuote.nights.map((night, index) => ({
      date: night.date,
      minor: withTax ? night.converted_minor : night.converted_taxable_minor,
      currency: shownQuote.currency,
      state: night.state,
      lines: sumLines(shownQuote.rooms.map((room) => room.nights[index].lines)),
    }));
    stripHolder.append(nightStrip(strip, info.zone));
  };

  const rereadStates = async (): Promise<void> => {
    if (!quote) return;
    quote = await api<Quote>(`/api/quotes/${quote.id}`);
    paintPrice();
  };

  const requote = async (): Promise<void> => {
    const rooms = selection.rooms.map((room, index) => ({
      room_type: room.room_type,
      plan: selection.plans[index] ?? 'refundable',
      breakfast: selection.breakfast[index] ?? false,
      adults: room.adults,
      ages: room.ages,
    }));
    try {
      quote = await api<Quote>('/api/quotes', {
        method: 'POST',
        body: { property: code, in: inDate, out: outDate, currency, rooms },
      });
      paintPrice();
    } catch (err) {
      const failure = failureOf(err);
      const reason = failure?.body.reason as { code: string; date?: string; n?: number } | undefined;
      if (reason) {
        frame.regions.roomAdvice.textContent = m(`reason.${reason.code}`, {
          date: reason.date ? dayMonth(reason.date, info.zone) : '',
          n: reason.n ?? 0,
          count: reason.n ?? 0,
        });
      }
      await rereadStates();
    }
  };

  const reserveNow = async (button: HTMLElement): Promise<void> => {
    const rooms = selection.rooms.map((room, index) => ({
      room_type: room.room_type,
      plan: selection.plans[index] ?? 'refundable',
      breakfast: selection.breakfast[index] ?? false,
      adults: room.adults,
      ages: room.ages,
    }));
    const fresh = await api<Quote>('/api/quotes', {
      method: 'POST',
      body: { property: code, in: inDate, out: outDate, currency, rooms },
      busy: button,
    });
    const checkoutParams = new URLSearchParams(params);
    checkoutParams.delete('cursor');
    checkoutParams.delete('sel');
    checkoutParams.set('lang', state.lang);
    checkoutParams.set('cur', currency);
    await navigate(`/checkout/${fresh.id}?${checkoutParams.toString()}`);
  };

  paintRooms();
  await requote();

  onEvent('availability', (data) => {
    if (data.property === code) void rereadStates();
  });
  onEvent('quote.changed', () => void requote());
}
