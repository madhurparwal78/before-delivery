import { useState } from 'preact/hooks';
import { Spinner } from '../ui/spinner.js';
import { COMPANY_SIZES, INDUSTRIES, PRODUCTS } from '../../shared/catalog.js';
import { checkEnquiry, type FieldErrors } from '../../shared/rules.js';
import { api } from '../api.js';
import { Art } from '../ui/art.js';
import { ErrorSummary, SelectField, TextArea, TextField } from '../ui/field.js';
import { InfoTip } from '../ui/info-tip.js';

type Source = 'contact' | 'licensing';

const EMPTY = {
  first_name: '',
  last_name: '',
  full_name: '',
  email: '',
  company: '',
  company_size: '',
  industry: '',
  message: '',
};

const WEIGHTS_TIP = "License Kinora's underlying AI model weights for your bespoke requirements. Custom pricing.";

/** The full-page confirmation an accepted enquiry is replaced by. */
export function EnquiryThanks() {
  return (
    <section class="confirmation container">
      <Art phrase="Thanks, a calm sunrise over still water" aspect="16:9" class="confirmation-art" />
      <h1 class="display">Thanks, we will be in touch within two business days.</h1>
      <a class="button button-dark" href="/">Back to home</a>
    </section>
  );
}

export function EnquiryForm({ source, onSent }: { source: Source; onSent: () => void }) {
  const [values, setValues] = useState(EMPTY);
  const [products, setProducts] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sending, setSending] = useState(false);
  const licensing = source === 'licensing';
  const id = (field: string) => `${source}-${field}`;

  const set = (field: keyof typeof EMPTY) => (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const refuse = (found: FieldErrors) => {
    setErrors(found);
    const first = Object.keys(found)[0];
    document.getElementById(first === 'products' ? id('products-0') : id(first))?.focus();
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    const body = {
      source,
      first_name: licensing ? null : values.first_name,
      last_name: licensing ? null : values.last_name,
      full_name: licensing ? values.full_name : null,
      email: values.email,
      company: values.company,
      company_size: values.company_size,
      industry: values.industry,
      products: licensing ? null : products,
      message: values.message,
    };
    const checked = checkEnquiry(body);
    if (!checked.ok) return refuse(checked.errors);
    setSending(true);
    const reply = await api('POST', '/enquiries', body);
    setSending(false);
    if (reply.ok) onSent();
    else refuse(reply.errors ?? { message: 'We could not send your enquiry. Try again in a moment.' });
  };

  const text = (field: keyof typeof EMPTY, label: string, extra: Record<string, unknown> = {}) => (
    <TextField
      id={id(field)}
      label={label}
      required
      error={errors[field]}
      value={values[field]}
      onInput={set(field)}
      {...extra}
    />
  );

  return (
    <form class="enquiry-form" noValidate onSubmit={submit}>
      <ErrorSummary count={Object.keys(errors).length} />
      {licensing ? (
        text('full_name', 'Full Name', { autocomplete: 'name' })
      ) : (
        <div class="field-row">
          {text('first_name', 'First Name', { autocomplete: 'given-name' })}
          {text('last_name', 'Last Name', { autocomplete: 'family-name' })}
        </div>
      )}
      {text('email', 'Business Email', { type: 'email', autocomplete: 'email' })}
      {text('company', 'Company', { autocomplete: 'organization' })}
      <div class="field-row">
        <SelectField
          id={id('company_size')}
          label="Company Size"
          required
          prompt="Select an option"
          options={COMPANY_SIZES.map((size) => ({ value: size, label: size }))}
          error={errors.company_size}
          value={values.company_size}
          onChange={set('company_size')}
        />
        <SelectField
          id={id('industry')}
          label="Industry"
          required
          prompt="Select an option"
          options={INDUSTRIES.map((industry) => ({ value: industry, label: industry }))}
          error={errors.industry}
          value={values.industry}
          onChange={set('industry')}
        />
      </div>
      {!licensing && (
        <fieldset class={`field checks${errors.products ? ' has-error' : ''}`}>
          <legend>What Kinora products are you interested in? *</legend>
          {PRODUCTS.map((product, index) => (
            <div key={product.id} class="check">
              <input
                type="checkbox"
                id={id(`products-${index}`)}
                checked={products.includes(product.id)}
                aria-describedby={errors.products ? id('products-error') : undefined}
                aria-invalid={errors.products ? 'true' : undefined}
                onChange={(event) => {
                  const on = (event.currentTarget as HTMLInputElement).checked;
                  setProducts((list) => (on ? [...list, product.id] : list.filter((p) => p !== product.id)));
                }}
              />
              <label for={id(`products-${index}`)}>{product.label}</label>
              {product.id === 'model-weights-licensing' && (
                <InfoTip id={id('weights')} label="About Model Weights Licensing" text={WEIGHTS_TIP} />
              )}
            </div>
          ))}
          {errors.products && (
            <p id={id('products-error')} class="field-error">
              {errors.products}
            </p>
          )}
        </fieldset>
      )}
      <TextArea
        id={id('message')}
        label="Message"
        required
        rows={5}
        error={errors.message}
        value={values.message}
        onInput={set('message')}
      />
      <button type="submit" class="button button-dark button-large" disabled={sending} aria-disabled={sending ? 'true' : undefined}>
        {sending && <Spinner />}
        Submit
      </button>
    </form>
  );
}

/** The enterprise enquiry: a drawn media panel beside (or above, on a phone) the form. */
export function EnterpriseEnquiry({ onSent, standalone }: { onSent: () => void; standalone?: boolean }) {
  const Title = standalone ? 'h1' : 'p';
  return (
    <section class="enquiry container">
      <div class="enquiry-panel">
        <Art phrase="Contact our enterprise team, warm amber bands over a dusk harbour" aspect="9:16" class="enquiry-art" />
        <div class="enquiry-panel-copy">
          <Title class="enquiry-panel-title">Contact our enterprise team.</Title>
          <p>Tell us what you're working on - we'll be in touch within two business days.</p>
        </div>
      </div>
      <div class="enquiry-body">
        <h2 class="heading">Tell us more about your use case.</h2>
        <EnquiryForm source="contact" onSent={onSent} />
      </div>
    </section>
  );
}
