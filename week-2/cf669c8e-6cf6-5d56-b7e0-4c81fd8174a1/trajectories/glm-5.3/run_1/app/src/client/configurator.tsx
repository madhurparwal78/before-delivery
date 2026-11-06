import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Fragment } from 'preact';
import type { ComponentChild } from 'preact';
import { api, ApiError, formatCents } from './api';
import type { Catalogue, PlateLookup, Quote, ScenePart } from './types';
import { MopedScene } from './scene';
import { drawStill } from './still';
import { CheckoutDialog } from './screens';
import { OutageBanner, useProviders } from './shared';

const PLATE_EXAMPLES: Record<string, string> = { NL: 'FGH-12-K', BE: 'A-KLM-204', DE: '418-RTV' };

// ---- Shared app context -----------------------------------------------------

let catalogue: Catalogue | null = null;

async function ensureCatalogue(): Promise<Catalogue> {
  if (!catalogue) catalogue = await api<Catalogue>('GET', '/api/catalogue');
  return catalogue;
}

// ---- Header -----------------------------------------------------------------

// ---- The configurator ---------------------------------------------------------

export interface ConfigState {
  donor: { plate: string; country: string } | { manual: { model: string; country: string; firstAdmissionYear: number; roadClass: 25 | 45; plateColour: string; registeredMassKg: number } } | null;
  packId: string;
  hubId: string;
  roadClass: 25 | 45;
  units: 'metric' | 'imperial';
  fulfilment: 'posted' | 'workshop';
  country: string;
  donorClass: 25 | 45;
}

function donorJson(donor: ConfigState['donor']): Record<string, unknown> {
  if (!donor) return {};
  if ('manual' in donor) return { manual: donor.manual };
  return { plate: donor.plate, country: donor.country };
}

function paramsToConfig(url: URL): ConfigState | null {
  const p = url.searchParams;
  if (!p.get('pack')) return null;
  const manual = p.get('manual') === '1';
  const donor: ConfigState['donor'] = manual
    ? {
        manual: {
          model: p.get('model') ?? 'K50',
          country: p.get('regCountry') ?? 'NL',
          firstAdmissionYear: Number(p.get('year')) || 2019,
          roadClass: (p.get('regClass') === '45' ? 45 : 25) as 25 | 45,
          plateColour: p.get('colour') ?? 'blue',
          registeredMassKg: Number(p.get('mass')) || 110,
        },
      }
    : { plate: p.get('plate') ?? '', country: p.get('regCountry') ?? 'NL' };
  const regClass = manual ? (p.get('regClass') === '45' ? 45 : 25) : 25;
  return {
    donor,
    packId: p.get('pack') ?? 'P-1500',
    hubId: p.get('hub') ?? 'H-1000',
    roadClass: (p.get('class') === '45' ? 45 : regClass) as 25 | 45,
    units: p.get('units') === 'imperial' ? 'imperial' : 'metric',
    fulfilment: p.get('fulfilment') === 'workshop' ? 'workshop' : 'posted',
    country: p.get('country') ?? 'NL',
    donorClass: regClass,
  };
}

function configToParams(c: ConfigState): string {
  const p = new URLSearchParams();
  if (c.donor && 'plate' in c.donor) {
    p.set('plate', c.donor.plate);
    p.set('regCountry', c.donor.country);
  } else if (c.donor) {
    p.set('manual', '1');
    p.set('model', c.donor.manual.model);
    p.set('regCountry', c.donor.manual.country);
    p.set('year', String(c.donor.manual.firstAdmissionYear));
    p.set('regClass', String(c.donor.manual.roadClass));
    p.set('colour', c.donor.manual.plateColour);
    p.set('mass', String(c.donor.manual.registeredMassKg));
  }
  p.set('pack', c.packId);
  p.set('hub', c.hubId);
  p.set('class', String(c.roadClass));
  p.set('units', c.units);
  p.set('fulfilment', c.fulfilment);
  p.set('country', c.country);
  return p.toString();
}

function useUser(): import('./types').User | null {
  const [u, setU] = useState<import('./types').User | null>(null);
  useEffect(() => {
    void api<import('./types').User>('GET', '/api/me').then((user) => setU(user)).catch(() => setU(null));
    const onChange = (e: Event) => setU((e as CustomEvent).detail);
    window.addEventListener('signed-in', onChange as EventListener);
    return () => window.removeEventListener('signed-in', onChange as EventListener);
  }, []);
  return u;
}

function useConfigState(url: URL): [ConfigState, (c: ConfigState) => void] {
  const initial = useMemo<ConfigState>(() => paramsToConfig(url) ?? {
    donor: null,
    packId: 'P-1500', hubId: 'H-1000',
    roadClass: 25 as const, units: 'metric' as const, fulfilment: 'posted' as const, country: 'NL', donorClass: 25 as const,
  }, [url.href]);
  const [config, setConfig] = useState<ConfigState>(initial);
  return [config, setConfig];
}

interface QuoteState {
  quote: Quote | null;
  figuresState: 'quoted' | 'checking' | 'not current';
  figuresMessage: string;
}

function Configurator({ url }: { url: URL }) {
  const user = useUser();
  const providers = useProviders();
  const [config, setConfig] = useConfigState(url);
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [quoteState, setQuoteState] = useState<QuoteState>({ quote: null, figuresState: 'checking', figuresMessage: 'Checking figures...' });
  const [lookupStatus, setLookupStatus] = useState('');
  const [verdict, setVerdict] = useState<{ word: string; sentence: string } | null>(null);
  const [selectedPart, setSelectedPart] = useState('');
  const [travel, setTravel] = useState<Record<string, number>>({});
  const [railsDriven, setRailsDriven] = useState<Record<string, boolean>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('');
  const sceneHost = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MopedScene | null>(null);
  const lookupSeq = useRef(0);
  const quoteSeq = useRef(0);

  useEffect(() => {
    void ensureCatalogue().then(setCat);
  }, []);

  // The address holds the configuration.
  useEffect(() => {
    if (!config.donor) return;
    const q = `/configure?${configToParams(config)}`;
    if (window.location.search && window.location.pathname === '/configure' && window.location.search === `?${configToParams(config)}`) return;
    history.pushState(null, '', q);
  }, [config]);

  const donorParts = useMemo<ScenePart[]>(() => {
    const base = cat?.parts ?? [];
    const donorModel = 'manual' in (config.donor ?? {}) ? (config.donor as { manual: { model: string } }).manual.model : null;
    void donorModel;
    return base;
  }, [cat, config.donor]);

  // Quote and fit check whenever the configuration changes.
  useEffect(() => {
    if (!config.donor) return;
    const seq = ++quoteSeq.current;
    setQuoteState((s) => ({ ...s, figuresState: 'checking', figuresMessage: 'Checking figures...' }));
    api<Quote>('POST', '/api/quotes', {
      donor: donorJson(config.donor),
      packId: config.packId,
      hubId: config.hubId,
      roadClass: config.roadClass,
      fulfilment: config.fulfilment,
      country: config.country,
      units: config.units,
    }).then((quote) => {
      if (seq !== quoteSeq.current) return;
      setQuoteState({
        quote,
        figuresState: 'quoted',
        figuresMessage: `Total ${formatCents(quote.totalCents)} quoted. VAT ${formatCents(quote.vatCents)}. Range ${quote.fit.rangeKm} km.`,
      });
      setVerdict({ word: quote.fit.word, sentence: quote.fit.sentence });
      if (quote.fit.parts) sceneRef.current?.setParts(quote.fit.parts);
      sceneRef.current?.setRails(quote.fit.rails);
    }).catch((e) => {
      if (seq !== quoteSeq.current) return;
      if (e instanceof ApiError && e.status === 503) {
        setQuoteState({ quote: null, figuresState: 'not current', figuresMessage: 'Figures could not be refreshed. Nothing here is a current quote.' });
      } else if (e instanceof ApiError && e.status === 404) {
        setLookupStatus('No scooter found for that plate.');
        setQuoteState({ quote: null, figuresState: 'not current', figuresMessage: 'Figures could not be refreshed. Nothing here is a current quote.' });
      } else {
        setQuoteState({ quote: null, figuresState: 'not current', figuresMessage: 'Figures could not be refreshed. Nothing here is a current quote.' });
      }
    });
  }, [config]);

  const lookUpPlate = async (rawPlate: string, country: string) => {
    const seq = ++lookupSeq.current;
    setLookupStatus(`Looking up ${rawPlate}...`);
    try {
      const found = await api<PlateLookup>('POST', '/api/plates/lookup', { plate: rawPlate, country });
      if (seq !== lookupSeq.current) return;
      setLookupStatus(`Found ${found.modelName}, ${found.firstAdmissionYear}, ${found.className}, ${found.plateColour} plate.`);
      setConfig({ ...config, donor: { plate: found.plate, country: found.country }, donorClass: found.roadClass, roadClass: found.roadClass });
    } catch (e) {
      if (seq !== lookupSeq.current) return;
      if (e instanceof ApiError && e.status === 404) setLookupStatus('No scooter found for that plate.');
      else if (e instanceof ApiError && e.status === 422) setLookupStatus(`Enter a plate like ${PLATE_EXAMPLES[country] ?? 'FGH-12-K'}.`);
      else if (e instanceof ApiError && e.status === 503) setLookupStatus('Plate registry unreachable. Your fit stays unconfirmed until it answers.');
      else setLookupStatus('No scooter found for that plate.');
    }
  };

  const railsReady = railsDriven['traction-pack'] === true && railsDriven['hub-motor'] === true;
  const checkoutAllowed = railsReady && quoteState.figuresState === 'quoted' && quoteState.quote?.fit.verdict === 'fits' && quoteState.quote?.fit.confirmed === true;

  return (
    <main>
      <h1>Configure your retrofit</h1>
      <OutageBanner />
      <p role="status" aria-live="polite" aria-label="Plate lookup" class="status-line">{lookupStatus}</p>
      <PlateEntry onLookup={lookUpPlate} registryUp={providers.registry === 'up'} onManual={(manual) => {
        setConfig({ ...config, donor: { manual }, donorClass: manual.roadClass, roadClass: manual.roadClass });
        setLookupStatus('');
      }} />

      <div class="config-layout">
        <div class="config-left">
          <div class="panel">
            <div class="title-block">
              <span class="tb-title">Ommezwaai Feeler</span>
              <span>{config.donor && 'plate' in config.donor ? `Donor ${config.donor.plate}` : config.donor ? 'Donor by hand' : 'No donor yet'}</span>
              <span><span class={`class-mark ${config.roadClass === 25 ? 'c25' : 'c45'}`} />{config.roadClass} km/h</span>
              <span>Kit {config.packId} + {config.hubId}</span>
            </div>
            <div class="scene-holder" ref={sceneHost}>
              <SceneView
                host={sceneHost}
                parts={donorParts}
                selectedPart={selectedPart}
                onSelect={(id) => setSelectedPart(id)}
                travel={travel}
                rails={quoteState.quote?.fit.rails ?? null}
                foulingFeature={(selectedPart === 'traction-pack' ? quoteState.quote?.fit.rails.pack.foulingFeature : quoteState.quote?.fit.rails.hub.foulingFeature) ?? null}
                sceneRef={sceneRef}
                onTravel={(id, mm) => setTravel((t) => ({ ...t, [id]: mm }))}
                onDriven={(id) => setRailsDriven((r) => ({ ...r, [id]: true }))}
              />
            </div>
          </div>
          {selectedPart === 'traction-pack' || selectedPart === 'hub-motor' ? (
            <ClearanceReadout
              part={selectedPart}
              rails={quoteState.quote?.fit.rails ?? null}
              travel={travel[selectedPart] ?? 0}
              onTravel={(mm) => {
                const rail = selectedPart === 'traction-pack' ? quoteState.quote?.fit.rails.pack : quoteState.quote?.fit.rails.hub;
                const clamped = rail && rail.foulingFeature !== null ? Math.min(mm, rail.stopTravelMm) : mm;
                setTravel((t) => ({ ...t, [selectedPart]: clamped }));
              }}
              onDriven={() => setRailsDriven((r) => ({ ...r, [selectedPart]: true }))}
              units={config.units}
              sceneRef={sceneRef}
            />
          ) : null}
          <p role="status" aria-live="polite" aria-label="Fit verdict" class="status-line">
            {verdict ? `${verdict.word}. ${verdict.sentence}` : 'Checking fit...'}
          </p>
        </div>

        <div class="config-parts">
          <div class="panel">
            <h3>Parts schedule</h3>
            <PartsSchedule
              parts={donorParts}
              selectedPart={selectedPart}
              onSelect={(id) => {
                setSelectedPart(id);
                sceneRef.current?.setSelected(id);
                sceneRef.current?.setPanelFade(id, id === 'traction-pack' || id === 'hub-motor');
              }}
            />
          </div>
        </div>

        <div class="config-price">
          <div class="panel">
            <h3>Price rail</h3>
            <div role="region" aria-label="Price rail" data-figures={quoteState.figuresState}>
              {quoteState.quote?.lines.map((line) => (
                <div class="price-line" key={line.id}>
                  <span>{line.name}</span>
                  <span class="amount" data-cents={line.grossCents}>{formatCents(line.grossCents)} <span class="status-word">{quoteState.figuresState}</span></span>
                </div>
              ))}
              {quoteState.quote ? (
                <div class="price-line price-total">
                  <span>Total</span>
                  <span class="amount" data-cents={quoteState.quote.totalCents}>{formatCents(quoteState.quote.totalCents)} <span class="status-word">{quoteState.figuresState}</span></span>
                </div>
              ) : null}
              {quoteState.quote ? (
                <div class="price-line">
                  <span>VAT</span>
                  <span class="amount" data-cents={quoteState.quote.vatCents}>{formatCents(quoteState.quote.vatCents)} <span class="status-word">{quoteState.figuresState}</span></span>
                </div>
              ) : null}
              {quoteState.quote?.schedule.map((stage) => (
                <div class="price-line" key={stage.stage}>
                  <span>{stage.label}</span>
                  <span class="amount" data-cents={stage.amountCents}>{formatCents(stage.amountCents)} <span class="status-word">scheduled</span></span>
                </div>
              ))}
              {quoteState.quote?.notices.map((n) => <p key={n} style="font-size:0.85rem">{n}</p>)}
            </div>
            <p role="status" aria-live="polite" aria-label="Figures" class="status-line">{quoteState.figuresMessage}</p>
            <p role="status" aria-live="polite" aria-label="Payment status" class="status-line" tabindex={-1}>{paymentStatus}</p>
            <button
              class="primary"
              aria-disabled={!checkoutAllowed}
              onClick={() => {
                if (!checkoutAllowed) {
                  setPaymentStatus(railsReady ? 'Fit not proven. No deposit can be taken.' : 'Drive the pack and hub to their stops first.');
                  return;
                }
                if (!user) {
                  sessionStorage.setItem('resume-config', window.location.pathname + window.location.search);
                  window.location.href = '/sign-in';
                  return;
                }
                setCheckoutOpen(true);
              }}
            >Start checkout</button>
          </div>
        </div>
      </div>

      {checkoutOpen && quoteState.quote ? (
        <CheckoutDialog
          quote={quoteState.quote}
          config={config}
          onClose={() => setCheckoutOpen(false)}
          onStatus={(msg) => setPaymentStatus(msg)}
          user={user}
          killbillUp={providers.killbill === 'up'}
        />
      ) : null}
    </main>
  );
}

function PlateEntry({ onLookup, onManual, registryUp }: { onLookup: (plate: string, country: string) => void; onManual: (m: { model: string; country: string; firstAdmissionYear: number; roadClass: 25 | 45; plateColour: string; registeredMassKg: number }) => void; registryUp: boolean }) {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [plate, setPlate] = useState('');
  const [country, setCountry] = useState('NL');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualError, setManualError] = useState('');
  useEffect(() => { void ensureCatalogue().then(setCat); }, []);
  const example = PLATE_EXAMPLES[country] ?? 'FGH-12-K';
  return (
    <section class="panel" aria-label="Plate entry">
      <h3>Your scooter</h3>
      <div class="two-col" style="grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem">
        <div class="field">
          <label for="plate-input">Plate</label>
          <input id="plate-input" aria-label="Plate" value={plate} onInput={(e) => setPlate((e.target as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label for="country-input">Registration country</label>
          <select id="country-input" aria-label="Registration country" value={country} onChange={(e) => setCountry((e.target as HTMLSelectElement).value)}>
            <option value="NL">NL</option>
            <option value="BE">BE</option>
            <option value="DE">DE</option>
          </select>
        </div>
        <div class="field" style="display:flex; align-items:flex-end">
          <button onClick={() => { if (plate.trim()) onLookup(plate.trim(), country); }}>Look up plate</button>
        </div>
      </div>
      <p style="font-size:0.85rem; font-family: var(--mono)" id="plate-hint">{`Enter a plate like ${example}.`}</p>
      <button aria-expanded={manualOpen} onClick={() => setManualOpen(!manualOpen)}>Enter frame details by hand</button>
      {manualOpen ? (
        <form aria-label="Frame details" onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const mass = Number(String(form.get('mass') ?? '0'));
          if (!Number.isFinite(mass) || (mass * 10) % 1 !== 0) {
            setManualError('Enter the registered mass in kg.');
            return;
          }
          setManualError('');
          onManual({
            model: String(form.get('model') ?? 'K50'),
            country: String(form.get('regCountry') ?? 'NL'),
            firstAdmissionYear: Number(form.get('year')),
            roadClass: form.get('regClass') === '45' ? 45 : 25,
            plateColour: String(form.get('colour') ?? 'blue'),
            registeredMassKg: mass,
          });
        }}>
          <div class="two-col" style="grid-template-columns: 1fr 1fr; gap: 0.5rem">
            <div class="field">
              <label for="m-model">Model</label>
              <select id="m-model" name="model" aria-label="Model">
                {(cat?.donors ?? []).map((d) => <option value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div class="field">
              <label for="m-year">First-admission year</label>
              <input id="m-year" name="year" type="number" aria-label="First-admission year" value={2019} />
            </div>
            <div class="field">
              <label for="m-class">Registered road class</label>
              <select id="m-class" name="regClass" aria-label="Registered road class">
                <option value="25">25 km/h</option>
                <option value="45">45 km/h</option>
              </select>
            </div>
            <div class="field">
              <label for="m-colour">Plate colour</label>
              <select id="m-colour" name="colour" aria-label="Plate colour">
                <option value="blue">blue</option>
                <option value="yellow">yellow</option>
                <option value="white">white</option>
              </select>
            </div>
            <div class="field">
              <label for="m-mass">Registered mass in kg</label>
              <input id="m-mass" name="mass" aria-label="Registered mass in kg" inputMode="decimal" placeholder="86.0" />
            </div>
            <div class="field">
              <label for="m-country">Registration country</label>
              <select id="m-country" name="regCountry" aria-label="Registration country">
                <option value="NL">NL</option>
                <option value="BE">BE</option>
                <option value="DE">DE</option>
              </select>
            </div>
          </div>
          {manualError ? <p class="error-text">{manualError}</p> : null}
          <button class="primary" type="submit">Try this frame</button>
        </form>
      ) : null}
      {!registryUp ? null : null}
    </section>
  );
}

function PartsSchedule({ parts, selectedPart, onSelect }: { parts: ScenePart[]; selectedPart: string; onSelect: (id: string) => void }) {
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const keydown = (e: KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIndex(Math.min(parts.length - 1, index + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIndex(Math.max(0, index - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setFocusIndex(0); }
    else if (e.key === 'End') { e.preventDefault(); setFocusIndex(parts.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(parts[index].id); }
  };
  useEffect(() => {
    const li = listRef.current?.children[focusIndex] as HTMLElement | undefined;
    li?.focus();
  }, [focusIndex]);
  return (
    <ul class="parts-list" role="listbox" aria-label="Parts schedule" ref={listRef} tabIndex={0}>
      {parts.map((part, index) => (
        <li
          key={part.id}
          role="option"
          tabIndex={index === focusIndex ? 0 : -1}
          aria-selected={selectedPart === part.id}
          data-part-id={part.id}
          data-position-mm={part.position.join(',')}
          data-panel-fade={selectedPart === 'traction-pack' || selectedPart === 'hub-motor'
            ? (part.fadedFor.includes(selectedPart === 'traction-pack' ? 'pack' : 'hub') ? '0.25' : '1')
            : '1'}
          onKeyDown={(e) => keydown(e, index)}
          onClick={() => { setFocusIndex(index); onSelect(part.id); }}
        >
          <span>{part.name}</span>
          <span class="part-dim">{part.dimension} mm</span>
        </li>
      ))}
    </ul>
  );
}

interface SceneViewProps {
  host: { current: HTMLElement | null };
  parts: ScenePart[];
  selectedPart: string;
  onSelect: (id: string) => void;
  travel: Record<string, number>;
  rails: { pack: { railMm: number; stopTravelMm: number }; hub: { railMm: number; stopTravelMm: number } } | null;
  foulingFeature: string | null;
  sceneRef: { current: MopedScene | null };
  onTravel: (id: string, mm: number) => void;
  onDriven: (id: string) => void;
}

function SceneView(props: SceneViewProps): ComponentChild {
  const { sceneRef } = props;
  const [, force] = useState(0);
  const stillCanvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<'webgl' | 'still'>('webgl');

  useEffect(() => {
    const host = props.host.current;
    if (!host || !props.parts.length) return;
    const scene = new MopedScene(props.parts, { onAttributes: () => force((n) => n + 1) });
    sceneRef.current = scene;
    renderer.current = scene.mount(host);
    force((n) => n + 1);
    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      scene.dispose();
      sceneRef.current = null;
      host.innerHTML = '';
    };
  }, [props.parts]);

  useEffect(() => {
    sceneRef.current?.setSelected(props.selectedPart);
    sceneRef.current?.setPanelFade(props.selectedPart, props.selectedPart === 'traction-pack' || props.selectedPart === 'hub-motor');
  }, [props.selectedPart]);

  useEffect(() => {
    if (renderer.current === 'still' && stillCanvas.current) {
      drawStill(stillCanvas.current, props.parts, {
        selectedPart: props.selectedPart,
        travelMm: props.travel,
        foulingPart: props.selectedPart,
        foulingFeature: props.foulingFeature,
      });
    }
  }, [props.travel, props.selectedPart, props.parts]);

  const isRailPart = props.selectedPart === 'traction-pack' || props.selectedPart === 'hub-motor';
  const rail = props.selectedPart === 'traction-pack' ? props.rails?.pack : props.rails?.hub;
  const currentTravel = props.travel[props.selectedPart] ?? 0;
  const leading = sceneRef.current?.screenPoint(props.selectedPart, 'leading');

  const handle = isRailPart && rail ? (
    <button
      aria-label="Rail handle"
      style={{
        position: 'absolute',
        left: `${(leading?.x ?? 0) - (props.host.current?.getBoundingClientRect().left ?? 0) - 22}px`,
        top: `${(leading?.y ?? 0) - (props.host.current?.getBoundingClientRect().top ?? 0) - 22}px`,
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        background: 'var(--accent)',
        border: '2px solid var(--accent-ink)',
        padding: 0,
        zIndex: 5,
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startTravel = currentTravel;
        const railLength = rail.railMm;
        const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          let next = startTravel + (dx / Math.max(100, rect.width * 0.5)) * railLength;
          next = Math.max(0, Math.min(rail.stopTravelMm, next));
          props.onTravel(props.selectedPart, Math.round(next));
          if (Math.round(next) >= rail.stopTravelMm) props.onDriven(props.selectedPart);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (currentTravel < rail.stopTravelMm && Math.round(currentTravel) < rail.stopTravelMm) {
            // Releasing short of contact springs the part back to the rail start.
            props.onTravel(props.selectedPart, 0);
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  ) : null;

  return (
    <div
      role="application"
      aria-label="Moped scene"
      tabIndex={0}
      data-renderer={renderer.current}
      data-mesh-count={renderer.current === 'webgl' ? (sceneRef.current?.state.meshCount ?? 0) : props.parts.length}
      data-azimuth-deg={sceneRef.current?.state.azimuthDeg ?? 30}
      data-elevation-deg={sceneRef.current?.state.elevationDeg ?? 15}
      data-zoom={sceneRef.current?.state.zoom ?? 1}
      data-selected-part={props.selectedPart}
      data-story-offsets={JSON.stringify({})}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); sceneRef.current?.orbit(-15, 0); force((n) => n + 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); sceneRef.current?.orbit(15, 0); force((n) => n + 1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); sceneRef.current?.orbit(0, 15); force((n) => n + 1); }
        if (e.key === 'ArrowDown') { e.preventDefault(); sceneRef.current?.orbit(0, -15); force((n) => n + 1); }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); sceneRef.current?.zoomBy(1.1); force((n) => n + 1); }
        if (e.key === '-') { e.preventDefault(); sceneRef.current?.zoomBy(0.9); force((n) => n + 1); }
        if (e.key === 'Home') { e.preventDefault(); sceneRef.current?.resetView(); force((n) => n + 1); }
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startY = e.clientY;
        const az0 = sceneRef.current?.state.azimuthDeg ?? 30;
        const el0 = sceneRef.current?.state.elevationDeg ?? 15;
        const move = (ev: PointerEvent) => {
          sceneRef.current?.orbit((ev.clientX - startX) * 0.2, (ev.clientY - startY) * 0.15);
          void az0; void el0;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    >
      {renderer.current === 'webgl' ? handle : (
        <canvas ref={stillCanvas} class="moped-still" aria-label="Moped drawing" />
      )}
    </div>
  );
}

function ClearanceReadout({ part, rails, travel, onTravel, onDriven, units, sceneRef }: {
  part: string;
  rails: { pack: import('./types').RailResult; hub: import('./types').RailResult } | null;
  travel: number;
  onTravel: (mm: number) => void;
  onDriven: () => void;
  units: 'metric' | 'imperial';
  sceneRef: { current: MopedScene | null };
}) {
  const rail = part === 'traction-pack' ? rails?.pack : rails?.hub;
  if (!rail) return null;
  const reached = rail.stations.filter((s) => travel >= s.travelMm);
  const gaps = rail.stations.map((s) => (travel >= s.travelMm ? s.gapMm : null));
  const smallest = Math.min(...reached.map((s) => s.gapMm ?? 0).filter((g) => g !== null));
  const contact = travel >= rail.stopTravelMm && rail.foulingFeature !== null;
  const leading = sceneRef.current?.screenPoint(part, 'leading');
  const foulingPoint = contact ? leading : null;
  useEffect(() => {
    sceneRef.current?.setTravel(part, travel);
    if (travel >= rail.stopTravelMm) onDriven();
  }, [travel, part]);
  useEffect(() => {
    sceneRef.current?.setFouling(contact ? part : null, rail.foulingFeature);
  }, [contact, rail.foulingFeature]);
  const fmt = (tenths: number | null) => {
    if (tenths === null) return '';
    const mm = tenths / 10;
    if (units === 'imperial') return `${(mm / 25.4).toFixed(3)} in`;
    return `${mm.toFixed(1)} mm`;
  };
  return (
    <div class="panel" role="region" aria-label="Clearance"
      data-part={part}
      data-travel-mm={(travel / 10).toFixed(1)}
      data-rail-mm={(rail.railMm / 10).toFixed(1)}
      data-gap-s1-mm={gaps[0] !== null && gaps[0] !== undefined ? (gaps[0]! / 10).toFixed(1) : ''}
      data-gap-s2-mm={gaps[1] !== null && gaps[1] !== undefined ? (gaps[1]! / 10).toFixed(1) : ''}
      data-gap-s3-mm={gaps[2] !== null && gaps[2] !== undefined ? (gaps[2]! / 10).toFixed(1) : ''}
      data-smallest-gap-mm={reached.length ? (smallest / 10).toFixed(1) : ''}
      data-contact={String(contact)}
      data-fouling-feature={contact ? rail.foulingFeature ?? '' : ''}
      data-fouling-screen-x={foulingPoint ? foulingPoint.x.toFixed(1) : ''}
      data-fouling-screen-y={foulingPoint ? foulingPoint.y.toFixed(1) : ''}
      data-leading-edge-screen-x={leading ? leading.x.toFixed(1) : ''}
      data-leading-edge-screen-y={leading ? leading.y.toFixed(1) : ''}
    >
      <h3>Clearance — {part === 'traction-pack' ? 'Traction pack' : 'Hub motor'}</h3>
      <label for="insertion-travel">Insertion travel</label>
      <input
        id="insertion-travel"
        type="range"
        aria-label="Insertion travel"
        min={0}
        max={rail.railMm / 10}
        step={0.1}
        value={travel / 10}
        aria-valuetext={units === 'imperial' ? `${(travel / 254).toFixed(3)} in` : `${(travel / 10).toFixed(1)} mm`}
        onInput={(e) => onTravel(Math.round(Number((e.target as HTMLInputElement).value) * 10))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onTravel(0);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      <div class="clearance-grid">
        <span>Travel</span><span>{fmt(travel)}</span>
        <span>Rail</span><span>{fmt(rail.railMm)}</span>
        {rail.stations.map((s, i) => (
          <Fragment key={s.id}>
            <span>{s.name}</span>
            <span>{gaps[i] !== null && gaps[i] !== undefined ? fmt(gaps[i]) : '—'}</span>
          </Fragment>
        ))}
        <span>Smallest gap</span><span>{reached.length ? fmt(smallest) : ''}</span>
      </div>
      {contact ? <p class="alert-banner">Fouls at {rail.foulingFeature}</p> : null}
    </div>
  );
}

export { Configurator };
