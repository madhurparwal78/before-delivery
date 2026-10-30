import { useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { COMPANY_SIZES, INDUSTRIES, PRODUCTS, validateEnquiry } from '../../shared/forms';
import { Art, FieldError, SelectField, Spinner, TextAreaField, TextField } from './ui';
import { InfoCircle } from './Icons';

type Values = Record<string, string>;

function ProductTip({ tip, name }: { tip: string; name: string }) {
  const [open, setOpen] = useState(false);
  const id = `product-tip-${name}`;
  return (
    <span class="tip-holder">
      <button
        type="button"
        class="tip-button"
        aria-label={`About ${name}`}
        aria-expanded={open ? 'true' : 'false'}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <InfoCircle />
      </button>
      {open ? (
        <span class="tip-bubble" id={id} role="note">
          {tip}
        </span>
      ) : null}
    </span>
  );
}

export function EnquiryDone() {
  return (
    <div class="confirm-page">
      <h1>Thanks, we will be in touch within two business days.</h1>
      <a class="btn btn-dark btn-pill" href="/">
        Back to home
      </a>
    </div>
  );
}

export function EnquiryForm({ source, onDone }: { source: 'contact' | 'licensing'; onDone: () => void }) {
  const [values, setValues] = useState<Values>({
    first_name: '',
    last_name: '',
    full_name: '',
    email: '',
    company: '',
    company_size: '',
    industry: '',
    message: ''
  });
  const [products, setProducts] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  const set = (name: string) => (value: string) => setValues((current) => ({ ...current, [name]: value }));

  const submit = async (event: Event) => {
    event.preventDefault();
    const body = {
      source,
      ...values,
      products: source === 'contact' ? products : undefined
    };
    const found = validateEnquiry(body);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setErrors({});
    setSending(true);
    try {
      await api('/api/enquiries', { method: 'POST', body });
      onDone();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
    } finally {
      setSending(false);
    }
  };

  return (
    <form class="form-grid" onSubmit={submit} noValidate>
      {source === 'contact' ? (
        <>
          <TextField
            label="First Name"
            name="first_name"
            required
            value={values.first_name}
            onInput={set('first_name')}
            error={errors.first_name}
            autocomplete="given-name"
          />
          <TextField
            label="Last Name"
            name="last_name"
            required
            value={values.last_name}
            onInput={set('last_name')}
            error={errors.last_name}
            autocomplete="family-name"
          />
        </>
      ) : (
        <TextField
          label="Full Name"
          name="full_name"
          required
          value={values.full_name}
          onInput={set('full_name')}
          error={errors.full_name}
          autocomplete="name"
          className="span-2"
        />
      )}

      <TextField
        label="Business Email"
        name="email"
        type="email"
        required
        value={values.email}
        onInput={set('email')}
        error={errors.email}
        autocomplete="email"
      />
      <TextField
        label="Company"
        name="company"
        required
        value={values.company}
        onInput={set('company')}
        error={errors.company}
        autocomplete="organization"
      />
      <SelectField
        label="Company Size"
        name="company_size"
        required
        prompt="Select an option"
        options={COMPANY_SIZES}
        value={values.company_size}
        onInput={set('company_size')}
        error={errors.company_size}
      />
      <SelectField
        label="Industry"
        name="industry"
        required
        prompt="Select an option"
        options={INDUSTRIES}
        value={values.industry}
        onInput={set('industry')}
        error={errors.industry}
      />

      {source === 'contact' ? (
        <fieldset class="fieldset span-2">
          <legend class="field-legend">What Kinora products are you interested in? *</legend>
          <div class="chip-group">
            {PRODUCTS.map((product) => (
              <label class="chip" key={product.id}>
                <input
                  type="checkbox"
                  name="products"
                  value={product.id}
                  checked={products.includes(product.id)}
                  onChange={(event) => {
                    const checked = (event.target as HTMLInputElement).checked;
                    setProducts((current) =>
                      checked ? [...current, product.id] : current.filter((id) => id !== product.id)
                    );
                  }}
                />
                {product.label}
                {product.tip ? <ProductTip tip={product.tip} name={product.label} /> : null}
              </label>
            ))}
          </div>
          <FieldError id="field-products-error" message={errors.products} />
        </fieldset>
      ) : null}

      <TextAreaField
        label="Message"
        name="message"
        required
        value={values.message}
        onInput={set('message')}
        error={errors.message}
        className="span-2"
      />

      <div class="span-2">
        <button type="submit" class="btn btn-dark btn-big" disabled={sending}>
          {sending ? <Spinner /> : null}
          Submit
        </button>
      </div>
    </form>
  );
}

export function EnquiryPanel({ seed }: { seed: string }) {
  return (
    <aside class="enquiry-panel">
      <Art seed={seed} title="Enterprise team artwork" decorative />
      <div class="enquiry-panel-body">
        <h2>Contact our enterprise team.</h2>
        <p style="color:#e7e7ee;margin:0">
          Tell us what you're working on - we'll be in touch within two business days.
        </p>
      </div>
    </aside>
  );
}
