import { call, get, post, RequestFailed } from '../api.ts';
import type { ScreenRender } from '../app.ts';
import { el, field, replace, setFieldError } from '../dom.ts';
import { dollars } from '../format.ts';
import { failureCopy, FIELDS_COPY, Region, withPending } from '../feedback.ts';
import type { ClayBody, Passport } from '../types.ts';

interface QuoteAnswer {
  readonly cubic_inches: number;
  readonly bisque: { fee_cents: number };
  readonly glaze: { fee_cents: number };
}

const QUOTE_DEBOUNCE_MS = 330;
const UNAVAILABLE = 'Quote unavailable — check the dimensions.';

export const renderLogPiece: ScreenRender = ({ mount, navigate }) => {
  const titleInput = el('input', { type: 'text', 'aria-label': 'Title', maxlength: 200 });
  const clayInput = el('select', { 'aria-label': 'Clay body' });
  const lengthInput = el('input', { type: 'number', step: '0.01', min: '0', 'aria-label': 'Length (in)' });
  const widthInput = el('input', { type: 'number', step: '0.01', min: '0', 'aria-label': 'Width (in)' });
  const heightInput = el('input', { type: 'number', step: '0.01', min: '0', 'aria-label': 'Height (in)' });
  const photoInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });

  const titleField = field('Title', titleInput, 'log-title');
  const clayField = field('Clay body', clayInput, 'log-clay');
  const lengthField = field('Length (in)', lengthInput, 'log-length');
  const widthField = field('Width (in)', widthInput, 'log-width');
  const heightField = field('Height (in)', heightInput, 'log-height');
  const photoField = field('Intake photo', photoInput, 'log-photo');

  const quoteBody = el('div', { class: 'stack' });
  const quotePanel = el('section', { class: 'panel quote', 'aria-label': 'Quote', role: 'region' }, [
    el('h2', { class: 'heading small', text: 'QUOTE' }),
    quoteBody,
  ]);
  const region = new Region('Piece status');
  const submit = el('button', { type: 'submit', class: 'btn primary', text: 'LOG PIECE' });

  const showUnavailable = (): void => {
    replace(quoteBody, [el('p', { class: 'muted', text: UNAVAILABLE })]);
  };
  showUnavailable();

  const showQuote = (quote: QuoteAnswer): void => {
    replace(quoteBody, [
      el('p', { class: 'mono big', text: `${quote.cubic_inches} CU IN` }),
      el('p', { class: 'mono', text: `BISQUE $${dollars(quote.bisque.fee_cents)}` }),
      el('p', { class: 'mono', text: `GLAZE $${dollars(quote.glaze.fee_cents)}` }),
    ]);
  };

  let timer = 0;
  const askQuote = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const dims = {
        length_in: Number(lengthInput.value),
        width_in: Number(widthInput.value),
        height_in: Number(heightInput.value),
      };
      if (
        [lengthInput, widthInput, heightInput].some((input) => input.value.trim() === '') ||
        Object.values(dims).some((value) => !Number.isFinite(value) || value <= 0)
      ) {
        showUnavailable();
        return;
      }
      void post<QuoteAnswer>('/api/quotes', dims)
        .then(showQuote)
        .catch(() => showUnavailable());
    }, QUOTE_DEBOUNCE_MS);
  };
  for (const input of [lengthInput, widthInput, heightInput]) {
    input.addEventListener('input', askQuote);
  }

  let loggedPieceId: string | null = null;

  const uploadPhoto = async (pieceId: string): Promise<void> => {
    const file = photoInput.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('photo', file);
    await call<{ photo_url: string }>('PUT', `/api/pieces/${pieceId}/photo`, { form });
  };

  const form = el('form', { class: 'log-form' }, [
    titleField.wrap,
    clayField.wrap,
    el('div', { class: 'dims' }, [lengthField.wrap, widthField.wrap, heightField.wrap]),
    quotePanel,
    photoField.wrap,
    submit,
    region.node,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const entry of [titleField, clayField, lengthField, widthField, heightField]) {
      setFieldError(entry.wrap.querySelector('input, select') as HTMLElement, entry.error, '');
    }
    void withPending(region, submit, 'Logging piece…', async () => {
      try {
        if (!loggedPieceId) {
          const piece = await post<Passport>('/api/pieces', {
            title: titleInput.value,
            clay_body_id: clayInput.value,
            length_in: Number(lengthInput.value),
            width_in: Number(widthInput.value),
            height_in: Number(heightInput.value),
          });
          loggedPieceId = piece.id;
        }
        await uploadPhoto(loggedPieceId);
        region.say('Piece logged. Bring it to the intake shelf.');
        const target = loggedPieceId;
        window.setTimeout(() => navigate(`/pieces/${target}`), 600);
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        const errors = error.failure.errors ?? {};
        setFieldError(titleInput, titleField.error, errors['title'] ?? '');
        setFieldError(clayInput, clayField.error, errors['clay_body_id'] ?? '');
        setFieldError(lengthInput, lengthField.error, errors['length_in'] ?? '');
        setFieldError(widthInput, widthField.error, errors['width_in'] ?? '');
        setFieldError(heightInput, heightField.error, errors['height_in'] ?? '');
        region.say(
          failureCopy(error.failure, {
            validation: FIELDS_COPY,
            photo_too_large:
              'Photo is larger than 5,000,000 bytes. The piece is logged; add a smaller photo.',
            unsupported_photo:
              'Use a JPEG, PNG or WebP photo. The piece is logged; add the photo again.',
            storage_unavailable:
              'Photo storage is unavailable. The piece is logged; add the photo again in a few minutes.',
          }),
        );
      }
    });
  });

  mount.appendChild(
    el('section', { class: 'panel' }, [
      el('h1', { class: 'heading', text: 'LOG A PIECE' }),
      form,
    ]),
  );

  void get<ClayBody[]>('/api/clay-bodies').then((bodies) => {
    replace(
      clayInput,
      bodies.map((body) => el('option', { value: body.id, text: body.name })),
    );
  });
};
