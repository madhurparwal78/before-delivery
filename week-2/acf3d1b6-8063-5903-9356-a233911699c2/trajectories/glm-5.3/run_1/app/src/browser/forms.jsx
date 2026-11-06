// Enquiry forms and the auth pages (sign up, sign in, join a team).
import { useState, useEffect } from 'preact/hooks';
import { api, saveToken, ApiError, FieldError, ErrorBanner, Spinner } from './client.jsx';
import { COMPANY_SIZES, INDUSTRIES, ENQUIRY_PRODUCTS } from '../content.mjs';
import { PublicLayout } from './chrome.jsx';
import { artUri } from '../art.mjs';
import {
  checkName, checkEmail, checkPassword, checkCompany, checkCompanySize,
  checkIndustry, checkMessage, checkProducts,
} from '../server/validation.mjs';

// ---------------------------------------------------------------- enquiry

export function EnquiryForm({ source, headingId }) {
  const [values, setValues] = useState({
    first_name: '', last_name: '', full_name: '', email: '',
    company: '', company_size: '', industry: '', products: [], message: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setValues({ ...values, [k]: e.target.value });
  const toggleProduct = (id) => {
    const has = values.products.includes(id);
    setValues({ ...values, products: has ? values.products.filter(p => p !== id) : [...values.products, id] });
  };

  const validate = () => {
    const e = {};
    if (source === 'contact') {
      const fn = checkName(values.first_name, 'First name'); if (fn) e.first_name = fn;
      const ln = checkName(values.last_name, 'Last name'); if (ln) e.last_name = ln;
      const pr = checkProducts(values.products); if (pr) e.products = pr;
    } else {
      const fn = checkName(values.full_name, 'Full name'); if (fn) e.full_name = fn;
    }
    const em = checkEmail(values.email); if (em) e.email = em;
    const co = checkCompany(values.company); if (co) e.company = co;
    const cs = checkCompanySize(values.company_size); if (cs) e.company_size = cs;
    const ind = checkIndustry(values.industry); if (ind) e.industry = ind;
    const ms = checkMessage(values.message); if (ms) e.message = ms;
    return e;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setSubmitting(true);
    try {
      await api('/api/enquiries', {
        method: 'POST',
        body: {
          source,
          first_name: source === 'contact' ? values.first_name : null,
          last_name: source === 'contact' ? values.last_name : null,
          full_name: source === 'licensing' ? values.full_name : null,
          email: values.email, company: values.company,
          company_size: values.company_size, industry: values.industry,
          products: source === 'contact' ? values.products : null,
          message: values.message,
        },
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.payload.errors) setErrors(err.payload.errors);
      else setErrors({ form: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div class="card" style="max-width:640px" role="status">
        <h2>Thanks, we will be in touch within two business days.</h2>
        <p class="caption">Your enquiry is with our sales team.</p>
        <a class="btn btn-dark" href="/">Back to home</a>
      </div>
    );
  }

  const req = 'req';
  return (
    <form onSubmit={submit} noValidate aria-labelledby={headingId}>
      <ErrorBanner message={errors.form} />
      <div class="form-grid">
        {source === 'contact' ? (
          <>
            <div class="field">
              <label class={req} for="enq-first">First Name</label>
              <input id="enq-first" class="input" value={values.first_name} onInput={set('first_name')}
                aria-invalid={!!errors.first_name} aria-describedby={errors.first_name ? 'enq-first-err' : null} />
              <FieldError message={errors.first_name} id="enq-first-err" />
            </div>
            <div class="field">
              <label class={req} for="enq-last">Last Name</label>
              <input id="enq-last" class="input" value={values.last_name} onInput={set('last_name')}
                aria-invalid={!!errors.last_name} aria-describedby={errors.last_name ? 'enq-last-err' : null} />
              <FieldError message={errors.last_name} id="enq-last-err" />
            </div>
          </>
        ) : (
          <div class="field span2">
            <label class={req} for="enq-full">Full Name</label>
            <input id="enq-full" class="input" value={values.full_name} onInput={set('full_name')}
              aria-invalid={!!errors.full_name} aria-describedby={errors.full_name ? 'enq-full-err' : null} />
            <FieldError message={errors.full_name} id="enq-full-err" />
          </div>
        )}
        <div class="field">
          <label class={req} for="enq-email">Business Email</label>
          <input id="enq-email" class="input" type="email" value={values.email} onInput={set('email')}
            aria-invalid={!!errors.email} aria-describedby={errors.email ? 'enq-email-err' : null} />
          <FieldError message={errors.email} id="enq-email-err" />
        </div>
        <div class="field">
          <label class={req} for="enq-company">Company</label>
          <input id="enq-company" class="input" value={values.company} onInput={set('company')}
            aria-invalid={!!errors.company} aria-describedby={errors.company ? 'enq-company-err' : null} />
          <FieldError message={errors.company} id="enq-company-err" />
        </div>
        <div class="field">
          <label class={req} for="enq-size">Company Size</label>
          <select id="enq-size" class="select" value={values.company_size} onChange={set('company_size')}
            aria-invalid={!!errors.company_size} aria-describedby={errors.company_size ? 'enq-size-err' : null}>
            <option value="">Select an option</option>
            {COMPANY_SIZES.map(s => <option value={s}>{s}</option>)}
          </select>
          <FieldError message={errors.company_size} id="enq-size-err" />
        </div>
        <div class="field">
          <label class={req} for="enq-industry">Industry</label>
          <select id="enq-industry" class="select" value={values.industry} onChange={set('industry')}
            aria-invalid={!!errors.industry} aria-describedby={errors.industry ? 'enq-industry-err' : null}>
            <option value="">Select an option</option>
            {INDUSTRIES.map(s => <option value={s}>{s}</option>)}
          </select>
          <FieldError message={errors.industry} id="enq-industry-err" />
        </div>
        {source === 'contact' && (
          <fieldset class="field span2" style="border:none;padding:0;margin:0 0 16px">
            <legend class="req" style="font-size:0.9rem;font-weight:600;color:var(--ink);padding:0">What Kinora products are you interested in?</legend>
            {ENQUIRY_PRODUCTS.map(p => (
              <div class="check-row">
                <input type="checkbox" id={`enq-prod-${p.id}`} checked={values.products.includes(p.id)}
                  onChange={() => toggleProduct(p.id)} />
                <label for={`enq-prod-${p.id}`} style="font-weight:400">{p.label}</label>
                {p.tip && <span class="caption" style="display:block;margin-left:30px">{p.tip}</span>}
              </div>
            ))}
            <FieldError message={errors.products} />
          </fieldset>
        )}
        <div class="field span2">
          <label class={req} for="enq-message">Message</label>
          <textarea id="enq-message" class="input" value={values.message} onInput={set('message')}
            aria-invalid={!!errors.message} aria-describedby={errors.message ? 'enq-message-err' : null} />
          <FieldError message={errors.message} id="enq-message-err" />
        </div>
      </div>
      <button type="submit" class="btn btn-accent" disabled={submitting}>
        {submitting ? <><Spinner /> Submitting</> : 'Submit'}
      </button>
    </form>
  );
}

export function EnterpriseContactPage() {
  return (
    <PublicLayout>
      <section class="section">
        <div class="container">
          <div class="enquiry-grid">
            <div class="panel" style="min-height:280px">
              <h2 style="font-size:1.4rem">Contact our enterprise team.</h2>
              <p class="caption">Tell us what you're working on - we'll be in touch within two business days.</p>
              <div class="frame" style="margin-top:22px">
                <img class="frame-art" src={artUri('Enterprise film studio lobby, calm light, drawn picture', '16:9')} alt="" />
              </div>
            </div>
            <div>
              <h1 id="enquiry-heading">Tell us more about your use case.</h1>
              <EnquiryForm source="contact" headingId="enquiry-heading" />
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- auth pages

export function SignupPage({ navigate }) {
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const set = (k) => (e) => setValues({ ...values, [k]: e.target.value });

  // A signed-in person has no business here; send them to the studio.
  useEffect(() => {
    api('/api/me').then(() => navigate('/studio')).catch(() => {});
  }, []);

  const submit = async (ev) => {
    ev.preventDefault();
    setSubmitting(true);
    try {
      const res = await api('/api/auth/signup', { method: 'POST', body: values });
      saveToken(res.token);
      navigate('/studio');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setErrors({ email: 'An account with this email already exists.' });
      else if (err instanceof ApiError && err.status === 422 && err.payload.errors) setErrors(err.payload.errors);
      else setErrors({ form: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <div class="auth-wrap">
        <div class="auth-card">
          <h1 style="font-size:1.6rem">Create your account</h1>
          <form onSubmit={submit} noValidate>
            <ErrorBanner message={errors.form} />
            <div class="field">
              <label class="req" for="su-name">Name</label>
              <input id="su-name" class="input" value={values.name} onInput={set('name')}
                aria-invalid={!!errors.name} aria-describedby={errors.name ? 'su-name-err' : null} />
              <FieldError message={errors.name} id="su-name-err" />
            </div>
            <div class="field">
              <label class="req" for="su-email">Email</label>
              <input id="su-email" class="input" type="email" value={values.email} onInput={set('email')}
                aria-invalid={!!errors.email} aria-describedby={errors.email ? 'su-email-err' : null} />
              <FieldError message={errors.email} id="su-email-err" />
            </div>
            <div class="field">
              <label class="req" for="su-password">Password</label>
              <input id="su-password" class="input" type="password" value={values.password} onInput={set('password')}
                aria-invalid={!!errors.password} aria-describedby={errors.password ? 'su-password-err' : null} />
              <FieldError message={errors.password} id="su-password-err" />
            </div>
            <button type="submit" class="btn btn-accent" style="width:100%" disabled={submitting}>
              {submitting ? <><Spinner /> Signing up</> : 'Sign up'}
            </button>
          </form>
        </div>
      </div>
    </PublicLayout>
  );
}

export function LoginPage({ navigate }) {
  const [values, setValues] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const set = (k) => (e) => setValues({ ...values, [k]: e.target.value });

  // A signed-in person has no business here; send them to the studio.
  useEffect(() => {
    api('/api/me').then(() => navigate('/studio')).catch(() => {});
  }, []);

  const submit = async (ev) => {
    ev.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api('/api/auth/login', { method: 'POST', body: values });
      saveToken(res.token);
      navigate('/studio');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Email or password is incorrect.');
      else if (err instanceof ApiError && err.status === 422 && err.payload.errors) setFieldErrors(err.payload.errors);
      else setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <div class="auth-wrap">
        <div class="auth-card">
          <h1 style="font-size:1.6rem">Welcome to Kinora</h1>
          <p class="caption">Don't have an account? <a class="u-link" href="/signup">Sign up for free</a></p>
          <form onSubmit={submit} noValidate>
            <ErrorBanner message={error} />
            <div class="field">
              <label class="req" for="li-email">Email</label>
              <input id="li-email" class="input" type="email" value={values.email} onInput={set('email')}
                aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'li-email-err' : null} />
              <FieldError message={fieldErrors.email} id="li-email-err" />
            </div>
            <div class="field">
              <label class="req" for="li-password">Password</label>
              <input id="li-password" class="input" type="password" value={values.password} onInput={set('password')}
                aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? 'li-password-err' : null} />
              <FieldError message={fieldErrors.password} id="li-password-err" />
            </div>
            <button type="submit" class="btn btn-accent" style="width:100%" disabled={submitting}>
              {submitting ? <><Spinner /> Logging in</> : 'Log in'}
            </button>
          </form>
        </div>
      </div>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- invite

export function InvitePage({ token, navigate }) {
  const [info, setInfo] = useState(null);
  const [state, setState] = useState('loading'); // loading | valid | invalid | joined
  const [values, setValues] = useState({ name: '', password: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const set = (k) => (e) => setValues({ ...values, [k]: e.target.value });

  useEffect(() => {
    api(`/api/invitations/${encodeURIComponent(token)}`)
      .then((res) => { setInfo(res); setState('valid'); })
      .catch(() => setState('invalid'));
  }, [token]);

  const submit = async (ev) => {
    ev.preventDefault();
    setSubmitting(true);
    try {
      const res = await api(`/api/invitations/${encodeURIComponent(token)}`, { method: 'POST', body: values });
      saveToken(res.token);
      setState('joined');
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.payload.errors) setErrors(err.payload.errors);
      else if (err instanceof ApiError && (err.status === 404)) setState('invalid');
      else setErrors({ form: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'loading') {
    return <PublicLayout><div class="container section"><p>Loading…</p></div></PublicLayout>;
  }
  if (state === 'invalid') {
    return (
      <PublicLayout>
        <div class="auth-wrap" style="text-align:center">
          <div class="auth-card">
            <h1 style="font-size:1.5rem">This invitation is no longer valid.</h1>
            <p class="caption">Ask your team's owner to send a new invitation.</p>
            <a class="btn btn-dark" href="/">Back to home</a>
          </div>
        </div>
      </PublicLayout>
    );
  }
  if (state === 'joined') {
    return (
      <PublicLayout>
        <div class="auth-wrap" style="text-align:center">
          <div class="auth-card" role="status">
            <h1 style="font-size:1.5rem">You’re in. Welcome to {info.workspace_name}.</h1>
            <p class="caption">Your seat's credits are already in the shared balance.</p>
            <button type="button" class="btn btn-accent" onClick={() => navigate('/studio')}>Open the studio</button>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div class="auth-wrap">
        <div class="auth-card">
          <h1 style="font-size:1.5rem">Join {info.workspace_name} on Kinora</h1>
          <p class="caption">Invited as <strong>{info.email}</strong></p>
          <form onSubmit={submit} noValidate>
            <ErrorBanner message={errors.form} />
            <div class="field">
              <label class="req" for="inv-name">Name</label>
              <input id="inv-name" class="input" value={values.name} onInput={set('name')}
                aria-invalid={!!errors.name} aria-describedby={errors.name ? 'inv-name-err' : null} />
              <FieldError message={errors.name} id="inv-name-err" />
            </div>
            <div class="field">
              <label class="req" for="inv-password">Password</label>
              <input id="inv-password" class="input" type="password" value={values.password} onInput={set('password')}
                aria-invalid={!!errors.password} aria-describedby={errors.password ? 'inv-password-err' : null} />
              <FieldError message={errors.password} id="inv-password-err" />
            </div>
            <button type="submit" class="btn btn-accent" style="width:100%" disabled={submitting}>
              {submitting ? <><Spinner /> Joining</> : 'Join team'}
            </button>
          </form>
        </div>
      </div>
    </PublicLayout>
  );
}
