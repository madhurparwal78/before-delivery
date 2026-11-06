import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { oneOf } from '../../shared/choice.js';
import type { RailPartId } from '../../shared/parts.js';
import type { FitResult, ManualFrame, PlateRecord, Quote, RoadClass } from '../../shared/types.js';
import { ApiError, post } from '../api.js';
import { ClassMark } from '../components/ClassMark.js';
import { Money, type Word } from '../components/Money.js';
import { Panel } from '../components/Panel.js';
import { length } from '../format.js';
import { useCatalogue } from '../catalogue.js';
import { isNarrow, useNarrow } from '../hooks.js';
import { navigate, useLocation } from '../router.js';
import {
  ClearanceRegion, PartsList, SceneModel, SceneView, TitleBlock, useReducedMotion, useSceneSnapshot,
  type ClearanceHandle, type PartsListHandle,
} from '../scene/index.js';
import { RESUME_KEY, useSession } from '../session.js';
import { CheckoutDialog, DONOR_UNCONFIRMED, FIT_NOT_PROVEN } from './Checkout.js';
import { configOf, donorInput, parseParams, toSearch, type Params } from './configurator-params.js';
import { KitOptions, PlateEntry } from './ConfigParts.js';
import { money } from '../format.js';

type Donor = { kind: 'none' } | { kind: 'plate'; record: PlateRecord } | { kind: 'manual'; frame: ManualFrame };
type Figures = 'none' | 'checking' | 'quoted' | 'not current';
const RAIL_PARTS: RailPartId[] = ['traction-pack', 'hub-motor'];

export function Configurator(): ReactNode {
  const location = useLocation();
  const params = useMemo(() => parseParams(location.search), [location.href]);
  const { user, providers } = useSession();
  const narrow = useNarrow();
  const reduced = useReducedMotion();
  const catalogue = useCatalogue();
  const model = useMemo(() => new SceneModel({ reducedMotion: reduced, units: params.units }), []);
  const snap = useSceneSnapshot(model);

  useEffect(() => { document.title = 'Configure · Ommezwaai Feeler'; }, []);
  useEffect(() => { model.setUnits(params.units); }, [model, params.units]);
  useEffect(() => { model.setReducedMotion(reduced); }, [model, reduced]);

  // ---- the donor: a plate read from the registry, or a frame entered by hand ---------------------------------------------------
  const [donor, setDonor] = useState<Donor>(params.manual ? { kind: 'manual', frame: params.manual } : { kind: 'none' });
  const [plateText, setPlateText] = useState(params.plate);
  const [regCountry, setRegCountry] = useState(params.regCountry);
  const [lookup, setLookup] = useState<{ text: string; invalid: boolean; unreachable: boolean }>({ text: '', invalid: false, unreachable: false });
  const lookupId = useRef(0);
  const donorRef = useRef(donor);
  donorRef.current = donor;
  const [retry, setRetry] = useState(0);

  const runLookup = (text: string, country: typeof regCountry, fromUrl: boolean): void => {
    const id = ++lookupId.current;
    setLookup({ text: `Looking up ${text}...`, invalid: false, unreachable: false });
    post<PlateRecord>('/api/plates/lookup', { plate: text, country }, { poll: true }).then((record) => {
      if (id !== lookupId.current) return;
      setDonor({ kind: 'plate', record });
      setPlateText(record.plate);
      setLookup({ text: `Found ${record.modelName}, ${record.firstAdmissionYear}, ${record.className}, ${record.plateColour} plate.`, invalid: false, unreachable: false });
      if (!fromUrl) navigate(toSearch({ ...paramsRef.current, plate: record.plate, regCountry: record.country, manual: null }, paramsRef.current.roadClass ?? record.roadClass));
    }, (error: unknown) => {
      if (id !== lookupId.current) return;
      setDonor({ kind: 'none' });
      const api = error instanceof ApiError ? error : null;
      if (api?.status === 404) setLookup({ text: 'No scooter found for that plate.', invalid: false, unreachable: false });
      else if (api?.status === 422) setLookup({ text: api.fields['plate'] ?? 'Enter a plate like FGH-12-K.', invalid: true, unreachable: false });
      else setLookup({ text: 'The plate could not be read just now.', invalid: false, unreachable: true });
    });
  };
  const paramsRef = useRef<Params>(params);
  paramsRef.current = params;

  // the address drives the donor (load, reload, back, forward); a lookup the rider pressed has already set it
  useEffect(() => {
    setRegCountry(params.regCountry);
    if (params.manual) {
      lookupId.current += 1;
      setDonor({ kind: 'manual', frame: params.manual });
      setLookup({ text: '', invalid: false, unreachable: false });
      return;
    }
    if (!params.plate) {
      lookupId.current += 1;
      setDonor({ kind: 'none' });
      return;
    }
    setPlateText(params.plate);
    const have = donorRef.current;
    if (have.kind === 'plate' && have.record.plate === params.plate && have.record.country === params.regCountry) return;
    runLookup(params.plate, params.regCountry, true);
  }, [params.plate, params.regCountry, params.manual ? JSON.stringify(params.manual) : '', retry]);

  // when the registry returns, a plate address that could not be read is read again, without a reload
  const lastRegistry = useRef(providers.registry);
  useEffect(() => {
    if (lastRegistry.current === 'down' && providers.registry === 'up' && params.plate && donorRef.current.kind === 'none') setRetry((n) => n + 1);
    lastRegistry.current = providers.registry;
  }, [providers.registry, params.plate]);

  const donorClass: RoadClass | null = donor.kind === 'plate' ? donor.record.roadClass : donor.kind === 'manual' ? donor.frame.roadClass : null;
  const roadClass: RoadClass = params.roadClass ?? donorClass ?? 25;
  const plateCanonical = donor.kind === 'plate' ? donor.record.plate : null;
  const donorKey = donor.kind === 'plate' ? `plate:${donor.record.country}:${donor.record.plate}` : donor.kind === 'manual' ? `manual:${JSON.stringify(donor.frame)}` : 'none';
  const proofKey = `${donorKey}|${params.pack}|${params.hub}|${roadClass}`;
  const proofKeyRef = useRef(proofKey);
  proofKeyRef.current = proofKey;

  // ---- figures --------------------------------------------------------------------------------------------------------------------
  const [quote, setQuote] = useState<Quote | null>(null);
  const [figures, setFigures] = useState<Figures>('none');
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [fit, setFit] = useState<{ key: string; result: FitResult } | null>(null);
  const [fitPending, setFitPending] = useState(false);
  const quoteId = useRef(0);
  const fitId = useRef(0);

  const config = useMemo(() => {
    const input = donorInput({ ...params, manual: donor.kind === 'manual' ? donor.frame : null }, plateCanonical);
    return input ? configOf(input, params, roadClass) : null;
  }, [donorKey, params.pack, params.hub, roadClass, params.units, params.fulfilment, params.country]);

  useEffect(() => {
    if (!config) {
      quoteId.current += 1;
      setFigures('none');
      return;
    }
    const id = ++quoteId.current;
    setFigures('checking');
    post<Quote>('/api/quotes', config, { poll: true }).then((next) => {
      if (id !== quoteId.current) return;
      setQuote(next);
      setQuoteErrors({});
      setFigures('quoted');
      setFit({ key: proofKeyRef.current, result: next.fit });
      model.setParts(next.fit.parts);
      model.setRails(next.fit.rails);
    }, (error: unknown) => {
      if (id !== quoteId.current) return;
      setFigures('not current');
      setQuoteErrors(error instanceof ApiError ? error.fields : {});
    });
  }, [config, model]);

  // ---- the Feeler Sweep proof: each rail driven to its stop in this page view ----------------------------------------------------
  const [driven, setDriven] = useState<{ key: string; parts: RailPartId[] }>({ key: '', parts: [] });
  const drivenParts = driven.key === proofKey ? driven.parts : [];
  useEffect(() => model.on('railStop', (part) => {
    const key = proofKeyRef.current;
    const stopped = oneOf(part, RAIL_PARTS);
    if (!stopped) return;
    setDriven((was) => ({ key, parts: was.key === key ? [...new Set([...was.parts, stopped])] : [stopped] }));
    const input = configRef.current;
    if (!input) return;
    const id = ++fitId.current;
    setFitPending(true);
    post<FitResult>('/api/fit-checks', { donor: input.donor, packId: input.packId, hubId: input.hubId, roadClass: input.roadClass, units: input.units }, { poll: true }).then((result) => {
      if (id !== fitId.current) return;
      setFit({ key, result });
      setFitPending(false);
    }, () => {
      if (id !== fitId.current) return;
      setFitPending(false);
    });
  }), [model]);
  const configRef = useRef(config);
  configRef.current = config;

  const verdictText = drivenParts.length === 0 ? '' : fitPending ? 'Checking fit...' : fit?.key === proofKey ? fit.result.sentence : '';
  const verdictWord = drivenParts.length > 0 && !fitPending && fit?.key === proofKey ? fit.result.word : undefined;
  const bothDriven = RAIL_PARTS.every((p) => drivenParts.includes(p));

  // ---- changes to the configuration go into the address ---------------------------------------------------------------------------------
  const change = (patch: Partial<Params>): void => {
    const next = { ...params, ...patch };
    navigate(toSearch(next, patch.roadClass ?? roadClass));
  };
  const tryFrame = (frame: ManualFrame): void => {
    navigate(toSearch({ ...params, plate: '', manual: frame, regCountry: frame.country }, params.roadClass ?? frame.roadClass));
  };

  // ---- the parts schedule and where focus goes --------------------------------------------------------------------------------------------
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetButton = useRef<HTMLButtonElement>(null);
  const partsList = useRef<PartsListHandle>(null);
  const clearance = useRef<ClearanceHandle>(null);
  const [focusRequest, setFocusRequest] = useState<'slider' | null>(null);
  const wasSheetOpen = useRef(false);
  wasSheetOpen.current = sheetOpen;

  useLayoutEffect(() => {
    if (!narrow && wasSheetOpen.current) {
      setSheetOpen(false);
      partsList.current?.focusRow();
    }
  }, [narrow]);
  useEffect(() => {
    if (focusRequest === 'slider' && snap.rail) {
      clearance.current?.focusSlider();
      setFocusRequest(null);
    }
  }, [focusRequest, snap.rail]);

  const onPick = (id: string): void => {
    if (!isNarrow()) return;
    setSheetOpen(false);
    if (id === 'traction-pack' || id === 'hub-motor') setFocusRequest('slider');
    else sheetButton.current?.focus();
  };
  const onEscape = (): void => {
    if (isNarrow()) sheetButton.current?.focus();
    else partsList.current?.focusRow();
  };

  // ---- checkout ------------------------------------------------------------------------------------------------------------------------------
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const checkoutButton = useRef<HTMLButtonElement>(null);
  const word: Word = figures === 'checking' ? 'checking' : figures === 'not current' ? 'not current' : 'quoted';
  const canStart = Boolean(quote) && figures === 'quoted' && bothDriven && config !== null && providers.killbill === 'up';
  const startReason = !config
    ? 'Look up a plate or enter frame details first.'
    : figures !== 'quoted' ? '' : !bothDriven ? 'Drive the pack and hub to their stops first.' : '';
  const start = (): void => {
    if (!canStart) return;
    if (!user) {
      sessionStorage.setItem(RESUME_KEY, `${window.location.pathname}${window.location.search}`);
      navigate('/sign-in');
      return;
    }
    setCheckoutOpen(true);
  };

  const figuresText = figures === 'checking' ? 'Checking figures...'
    : figures === 'not current' ? 'Figures could not be refreshed. Nothing here is a current quote.'
      : quote && figures === 'quoted' ? `Total ${money(quote.totalCents)} quoted. VAT ${money(quote.vatCents)}. Range ${quote.fit.rangeKm} km.` : '';

  const units = params.units;
  const registration = donor.kind === 'plate' ? donor.record.country : donor.kind === 'manual' ? donor.frame.country : null;
  const className = catalogue?.roadClasses.find((c) => c.country === registration && c.roadClass === roadClass)?.name ?? '';

  return (
    <section className="page configurator" aria-labelledby="cfg-title">
      <div className="cfg-entry">
        <h1 id="cfg-title" className="cfg-title">Prove the fit</h1>
        <PlateEntry
          plateText={plateText} onPlateText={setPlateText} regCountry={regCountry} onRegCountry={setRegCountry}
          onLookup={() => runLookup(plateText, regCountry, false)} lookupStatus={lookup.text} lookupInvalid={lookup.invalid}
          catalogue={catalogue} manual={params.manual} frameErrors={donor.kind === 'manual' ? quoteErrors : {}} onTryFrame={tryFrame}
        />
        <div role="status" aria-label="Figures" className="figures-status" data-current={figures === 'quoted'}>{figuresText}</div>
      </div>

      <div className="cfg-scene">
        <SceneView
          model={model} mode="config" onEscape={onEscape}
          titleBlock={(
            <TitleBlock
              donor={donor.kind === 'plate' ? `${donor.record.modelName} · ${donor.record.plate}` : donor.kind === 'manual' ? `${catalogue?.donors.find((d) => d.model === donor.frame.model)?.name ?? donor.frame.model} · hand-entered` : 'No donor yet'}
              kit={`${params.pack} + ${params.hub}`}
              roadClass={<ClassMark roadClass={roadClass} label={`${roadClass} km/h${className ? ` ${className}` : ''}`} />}
            />
          )}
        />
        <ClearanceRegion ref={clearance} model={model} verdictWord={verdictWord} onEscape={onEscape} />
        <div role="status" aria-label="Fit verdict" className="verdict-status">{verdictText}</div>
      </div>

      <div className="cfg-parts">
        <button type="button" ref={sheetButton} className="btn sheet-opener" aria-haspopup="dialog" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>Parts schedule<svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true" focusable="false"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg></button>
        <Panel open={sheetOpen} name="Parts schedule" variant="sheet" onClose={() => setSheetOpen(false)} opener={() => sheetButton.current}>
          <h2>Parts schedule</h2>
          <PartsList model={model} onPick={onPick} />
        </Panel>
        <div className="parts-column">
          <h2 className="column-title">Parts schedule</h2>
          <PartsList ref={partsList} model={model} onPick={onPick} />
        </div>
      </div>

      <section className="price-rail" aria-label="Price rail">
        <h2 className="column-title">Price rail</h2>
        <h3>Your kit</h3>
        <KitOptions
          catalogue={catalogue} pack={params.pack} hub={params.hub} roadClass={roadClass} units={units} fulfilment={params.fulfilment} country={params.country}
          roadClassError={quoteErrors['roadClass']} onChange={(patch) => change(patch)}
        />
        <h3>Figures</h3>
        {quote ? (
          <dl className="totals">
            <div><dt>Total</dt><dd><Money cents={quote.totalCents} word={word} figures className="big" /></dd></div>
            <div><dt>VAT at {quote.vatRatePct} percent</dt><dd><Money cents={quote.vatCents} word={word} figures /></dd></div>
            <div><dt>Range</dt><dd className="num">{quote.fit.rangeKm} km</dd></div>
            <div><dt>Built mass</dt><dd className="num">{quote.fit.builtMassKg} kg</dd></div>
            <div><dt>Smallest clearance</dt><dd className="num">{smallestGap(quote.fit, units)}</dd></div>
          </dl>
        ) : <p className="hint">Look up a plate or enter frame details to price a kit.</p>}
        <div className="checkout-start">
          <button type="button" ref={checkoutButton} className="btn primary" aria-disabled={!canStart} aria-describedby="start-reason" onClick={start}>Start checkout</button>
          <p id="start-reason" className="hint">{startReason}</p>
        </div>
        <div role="status" aria-label="Payment status" tabIndex={-1} className="payment-status" />
        {quote ? (
          <>
            <h4>Lines</h4>
            <table className="ruled-table lines" role="table" aria-label="Quote lines">
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Line</th><th role="columnheader" scope="col">Gross</th><th role="columnheader" scope="col">VAT</th></tr></thead>
              <tbody role="rowgroup">
                {quote.lines.map((line) => (
                  <tr role="row" key={line.id}>
                    <td role="cell" data-label="Line">{line.name}</td>
                    <td role="cell" data-label="Gross"><Money cents={line.grossCents} word={word} figures /></td>
                    <td role="cell" data-label="VAT"><Money cents={line.vatCents} word={word} figures /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4>Payment schedule</h4>
            <table className="ruled-table schedule" role="table" aria-label="Quoted schedule">
              <tbody role="rowgroup">
                {quote.schedule.map((s) => (
                  <tr role="row" key={s.stage}>
                    <td role="cell" data-label="Stage">{s.label}</td>
                    <td role="cell" data-label="Due" className="num">{s.dueDate}</td>
                    <td role="cell" data-label="Amount"><Money cents={s.amountCents} word={word} figures /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h5>Notices</h5>
            <ul className="notices">
              {quote.notices.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </>
        ) : null}
      </section>

      <Panel open={checkoutOpen} name="Checkout" variant="modal" onClose={() => setCheckoutOpen(false)} opener={() => checkoutButton.current}>
        {quote && config ? (
          <CheckoutDialog
            schedule={quote.schedule} totalCents={quote.totalCents} vatCents={quote.vatCents} notices={quote.notices} user={user}
            createBody={(plan) => ({ kind: 'kit', config, plan, expectedTotalCents: quote.totalCents })}
            gateReason={donor.kind !== 'plate' ? DONOR_UNCONFIRMED : quote.fit.verdict !== 'fits' ? FIT_NOT_PROVEN : ''}
            blocked={providers.killbill === 'down' || (providers.registry === 'down' && donor.kind === 'plate') || figures !== 'quoted'}
            onDone={(orderId) => { setCheckoutOpen(false); navigate(`/orders/${orderId}`); }}
          />
        ) : null}
      </Panel>
    </section>
  );
}

function smallestGap(fit: FitResult, units: 'metric' | 'imperial'): string {
  const gaps = [...fit.rails.pack.stations, ...fit.rails.hub.stations].flatMap((s) => (s.gapMm === null ? [] : [s.gapMm]));
  if (gaps.length === 0) return 'none';
  const smallest = gaps.reduce((a, b) => (Number(b) < Number(a) ? b : a));
  return length(smallest, units);
}
