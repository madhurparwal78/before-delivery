import { useEffect, useState, type ReactElement } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';
import { STOCKISTS } from '../../../shared/catalogue.js';
import { applicationCopy, stockistCopy } from '../../../shared/copy.js';
import { ApiCallError, api, type ApplicationPayload, type StockistPayload } from '../api.js';
import { Link, useRouter } from '../router.js';
import { NotFound } from './NotFound.js';

const CITIES = STOCKISTS.map((stockist) => ({
  name: stockist.city,
  lat: stockist.lat,
  lng: stockist.lng,
}));

export function Stockists(): ReactElement {
  const [city, setCity] = useState(CITIES[0]!.name);
  const [results, setResults] = useState<StockistPayload[]>([]);
  const [status, setStatus] = useState('');

  const search = async (lat: number, lng: number, place: string) => {
    try {
      const payload = await api.get<{ stockists: StockistPayload[] }>(
        `/api/stockists?lat=${lat}&lng=${lng}`,
      );
      setResults(payload.stockists);
      setStatus(stockistCopy.results(payload.stockists.length, place));
    } catch (error) {
      if (error instanceof ApiCallError) setStatus(error.failure.message);
    }
  };

  useEffect(() => {
    const chosen = CITIES.find((candidate) => candidate.name === city);
    if (chosen === undefined) return;
    void search(chosen.lat, chosen.lng, chosen.name);
    // The picker uses each stockist's coordinates for its city.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  const useMyLocation = () => {
    if (navigator.geolocation === undefined) {
      setStatus(stockistCopy.locationOff);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        void search(
          position.coords.latitude,
          position.coords.longitude,
          stockistCopy.yourLocation,
        ),
      () => setStatus(stockistCopy.locationOff),
    );
  };

  return (
    <div className="page paper stockists">
      <h1>Where to find Ceibo</h1>
      <p>Seven independent grocers carry Ceibo today. Pick a city to see the nearest five.</p>

      <div className="stockists__controls">
        <div className="field">
          <label htmlFor="stockist-city">Near</label>
          <select
            id="stockist-city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
          >
            {CITIES.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="button button--quiet" onClick={useMyLocation}>
          <LocateFixed aria-hidden="true" size={16} />
          Use my location
        </button>
      </div>

      <ul className="stockists__list" aria-label="Stockists">
        {results.map((stockist) => (
          <li key={stockist.name}>
            <MapPin aria-hidden="true" size={16} />
            <div>
              <h2>{stockist.name}</h2>
              <p>{stockist.address}</p>
              <p className="mono">
                {stockist.distance_km === null ? '' : `${stockist.distance_km.toFixed(1)} km`}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p role="status" aria-live="polite" aria-label="Stockist results" className="live-region">
        {status}
      </p>

      <p>
        Want to stock Ceibo? <Link to="/stockists/apply">Apply to become a stockist</Link>.
      </p>
    </div>
  );
}

export function StockistApply(): ReactElement {
  const { navigate } = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [province, setProvince] = useState('ON');
  const [licence, setLicence] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setErrors({});
    if (licence === null) {
      setErrors({ licence: applicationCopy.fields.unsupportedType });
      return;
    }
    setStatus(applicationCopy.pending);
    const form = new FormData();
    form.set('business_name', businessName);
    form.set('contact_name', contactName);
    form.set('email', email);
    form.set('province', province);
    form.set('licence', licence);

    const response = await fetch('/api/retailer-applications', { method: 'POST', body: form });
    const payload = (await response.json()) as
      | { application: ApplicationPayload }
      | { error: string; message: string; fields?: Record<string, string> };

    if (response.ok && 'application' in payload) {
      setStatus(applicationCopy.success(email));
      navigate(`/stockists/applications/${payload.application.id}`);
      return;
    }
    const failure = payload as { error: string; message: string; fields?: Record<string, string> };
    if (failure.error === 'too_large') setErrors({ licence: applicationCopy.fields.tooLarge });
    else if (failure.error === 'unsupported_type') {
      setErrors({ licence: applicationCopy.fields.unsupportedType });
    } else if (failure.error === 'files_unavailable' || failure.error === 'store_unavailable') {
      setStatus(applicationCopy.outage);
      return;
    } else if (failure.fields !== undefined) setErrors(failure.fields);
    setStatus('');
  };

  return (
    <div className="page paper narrow">
      <h1>Apply to stock Ceibo</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="apply-business">Business name</label>
          <input
            id="apply-business"
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
          />
          {errors.business_name === undefined ? null : (
            <p className="field__error">{errors.business_name}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="apply-contact">Contact name</label>
          <input
            id="apply-contact"
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
          />
          {errors.contact_name === undefined ? null : (
            <p className="field__error">{errors.contact_name}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="apply-email">Email</label>
          <input
            id="apply-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {errors.email === undefined ? null : <p className="field__error">{errors.email}</p>}
        </div>
        <div className="field">
          <label htmlFor="apply-province">Province</label>
          <select
            id="apply-province"
            value={province}
            onChange={(event) => setProvince(event.target.value)}
          >
            {[
              'AB',
              'BC',
              'MB',
              'NB',
              'NL',
              'NS',
              'NT',
              'NU',
              'ON',
              'PE',
              'QC',
              'SK',
              'YT',
            ].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          {errors.province === undefined ? null : <p className="field__error">{errors.province}</p>}
        </div>
        <div className="field">
          <label htmlFor="apply-licence">Business licence (PDF, PNG or JPEG)</label>
          <input
            id="apply-licence"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(event) => setLicence(event.target.files?.[0] ?? null)}
          />
          {errors.licence === undefined ? null : <p className="field__error">{errors.licence}</p>}
        </div>
        <button type="submit" className="button button--primary">
          Submit application
        </button>
      </form>
      <p role="status" aria-live="polite" aria-label="Application status" className="live-region">
        {status}
      </p>
    </div>
  );
}

export function StockistApplication({ id }: { id: string }): ReactElement {
  const [application, setApplication] = useState<ApplicationPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void api
      .get<{ application: ApplicationPayload }>(`/api/retailer-applications/${id}`)
      .then((payload) => setApplication(payload.application))
      .catch(() => setMissing(true));
  }, [id]);

  if (missing) return <NotFound />;
  if (application === null) return <div className="page paper narrow" />;

  const label =
    application.status === 'submitted'
      ? 'Submitted'
      : application.status === 'approved'
        ? 'Approved'
        : 'Declined';

  return (
    <div className="page paper narrow">
      <h1>Application received</h1>
      <dl className="subscription__facts">
        <dt>Business</dt>
        <dd>{application.business_name}</dd>
        <dt>Status</dt>
        <dd>{label}</dd>
        <dt>Submitted</dt>
        <dd className="mono">{application.submitted_at}</dd>
      </dl>
      <Link to="/stockists">Back to stockists</Link>
    </div>
  );
}
