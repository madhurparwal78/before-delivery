/**
 * The configurator: plate entry, the scene, the Clearance readout, the parts
 * schedule and the price rail.
 *
 * The address holds the whole configuration, so reload, share, back and
 * forward restore it. Figures change in place: they read `checking` while a
 * re-quote is in flight, and only the latest answer may change anything, so a
 * slow earlier reply is dropped whichever order the answers arrive in.
 */

import { ApiCallError, NetworkError, api, type Catalogue } from '../api.js';
import { formatLength, tenthsKwToString } from '../../shared/format.js';
import type { FitResult, Quote, Units } from '../../shared/types.js';
import {
  el,
  onReducedMotionChange,
  qsa,
  setAttrIfChanged,
  setMoneyDisabled,
  setTextIfChanged,
} from '../dom.js';
import { Panel, rovingList } from '../ui/dialog.js';
import { figure } from '../ui/money.js';
import { buildParts, type ScenePart } from '../scene/geometry.js';
import { SceneView, type RailSpec } from '../scene/view.js';
import { store } from '../state.js';
import { openCheckout } from './checkout.js';
import type { Page, PageContext, PageFactory } from '../main.js';

const SHEET_BREAKPOINT = 768;
const PACK_PART = 'traction-pack';
const HUB_PART = 'hub-motor';
const RAIL_PARTS: Record<string, 'pack' | 'hub'> = { [PACK_PART]: 'pack', [HUB_PART]: 'hub' };

export const RAILS_NOT_DRIVEN = 'Drive the pack and hub to their stops first.';
export const FIT_NOT_PROVEN = 'Fit not proven. No deposit can be taken.';
export const DONOR_UNCONFIRMED = 'Donor unconfirmed. No deposit can be taken.';
export const CHECKING_FIGURES = 'Checking figures...';
export const FIGURES_STALE = 'Figures could not be refreshed. Nothing here is a current quote.';

interface ConfigState {
  plate: string | null;
  regCountry: 'NL' | 'BE' | 'DE';
  manual: boolean;
  model: string;
  year: number;
  regClass: 25 | 45;
  colour: 'blue' | 'yellow' | 'white';
  mass: string;
  packId: string;
  hubId: string;
  roadClass: 25 | 45;
  units: Units;
  fulfilment: 'posted' | 'workshop';
  country: 'NL' | 'BE' | 'DE' | 'LU';
}

function readAddress(catalogue: Catalogue): ConfigState {
  const query = new URLSearchParams(window.location.search);
  const donorClass = Number(query.get('regClass')) === 45 ? 45 : 25;
  return {
    plate: query.get('plate'),
    regCountry: (query.get('regCountry') as ConfigState['regCountry']) ?? 'NL',
    manual: query.get('manual') === '1',
    model: query.get('model') ?? catalogue.donors[0]?.model ?? 'K50',
    year: Number(query.get('year')) || 2019,
    regClass: donorClass,
    colour: (query.get('colour') as ConfigState['colour']) ?? 'blue',
    mass: query.get('mass') ?? '110.0',
    packId: query.get('pack') ?? 'P-1500',
    hubId: query.get('hub') ?? 'H-1000',
    roadClass: Number(query.get('class')) === 45 ? 45 : Number(query.get('class')) === 25 ? 25 : donorClass,
    units: query.get('units') === 'imperial' ? 'imperial' : 'metric',
    fulfilment: query.get('fulfilment') === 'workshop' ? 'workshop' : 'posted',
    country: (query.get('country') as ConfigState['country']) ?? 'NL',
  };
}

function writeAddress(state: ConfigState): string {
  const query = new URLSearchParams();
  if (state.manual) {
    query.set('manual', '1');
    query.set('model', state.model);
    query.set('regCountry', state.regCountry);
    query.set('year', String(state.year));
    query.set('regClass', String(state.regClass));
    query.set('colour', state.colour);
    query.set('mass', state.mass);
  } else if (state.plate) {
    query.set('plate', state.plate);
    query.set('regCountry', state.regCountry);
  }
  query.set('pack', state.packId);
  query.set('hub', state.hubId);
  query.set('class', String(state.roadClass));
  query.set('units', state.units);
  query.set('fulfilment', state.fulfilment);
  query.set('country', state.country);
  return `/configure?${query.toString()}`;
}

function donorBody(state: ConfigState): unknown {
  if (state.manual) {
    return {
      manual: {
        model: state.model,
        country: state.regCountry,
        firstAdmissionYear: state.year,
        roadClass: state.regClass,
        plateColour: state.colour,
        registeredMassKg: state.mass,
      },
    };
  }
  return state.plate ? { plate: state.plate, country: state.regCountry } : null;
}

export const configurePage: PageFactory = (context: PageContext): Page => {
  let detach: (() => void)[] = [];

  return {
    async mount(container) {
      const catalogue = await store.loadCatalogue();
      let state = readAddress(catalogue);

      // Only the latest answer may change the donor, figures, status or address.
      let lookupSequence = 0;
      let quoteSequence = 0;

      let quote: Quote | null = null;
      let fit: FitResult | null = null;
      const driven = { pack: false, hub: false };

      // ---- status regions -------------------------------------------------
      const plateStatus = el('p', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Plate lookup' });
      const verdictStatus = el('p', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Fit verdict' });
      const figuresStatus = el('p', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Figures' });
      const paymentStatus = el('p', {
        class: 'status',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Payment status',
        tabindex: -1,
      });

      // ---- plate entry ----------------------------------------------------
      const plateField = el('input', { type: 'text', id: 'plate', 'aria-label': 'Plate', value: state.plate ?? '' });
      const plateError = el('p', { class: 'field-error', hidden: true });
      const regCountry = el('select', { id: 'reg-country', 'aria-label': 'Registration country' });
      for (const code of ['NL', 'BE', 'DE']) {
        regCountry.append(el('option', { value: code, selected: state.regCountry === code }, [code]));
      }
      const lookupButton = el('button', { type: 'button', class: 'primary' }, ['Look up plate']);
      const handButton = el('button', { type: 'button' }, ['Enter frame details by hand']);

      // ---- hand-entered frame details ------------------------------------
      const modelSelect = el('select', { id: 'model', 'aria-label': 'Model' });
      for (const donor of catalogue.donors) {
        modelSelect.append(el('option', { value: donor.model, selected: donor.model === state.model }, [donor.name]));
      }
      const yearField = el('input', { type: 'number', id: 'year', 'aria-label': 'First-admission year', value: String(state.year) });
      const regClassSelect = el('select', { id: 'reg-class', 'aria-label': 'Registered road class' });
      for (const value of [25, 45]) {
        regClassSelect.append(
          el('option', { value: String(value), selected: state.regClass === value }, [`${value} km/h`]),
        );
      }
      const colourSelect = el('select', { id: 'colour', 'aria-label': 'Plate colour' });
      for (const value of ['blue', 'yellow', 'white']) {
        colourSelect.append(el('option', { value, selected: state.colour === value }, [value]));
      }
      const massField = el('input', { type: 'text', id: 'mass', 'aria-label': 'Registered mass in kg', value: state.mass });
      const tryFrame = el('button', { type: 'submit', class: 'primary' }, ['Try this frame']);
      const frameForm = el('form', { class: 'frame-form grid-fields', 'aria-label': 'Frame details', hidden: !state.manual }, [
        el('label', { for: 'model' }, ['Model']),
        modelSelect,
        el('label', { for: 'year' }, ['First-admission year']),
        yearField,
        el('label', { for: 'reg-class' }, ['Registered road class']),
        regClassSelect,
        el('label', { for: 'colour' }, ['Plate colour']),
        colourSelect,
        el('label', { for: 'mass' }, ['Registered mass in kg']),
        massField,
        tryFrame,
      ]);

      const plateBlock = el('section', { class: 'plate-block ruled' }, [
        el('h2', { class: 'heading-3' }, ['Your scooter']),
        el('div', { class: 'plate-row' }, [
          el('label', { for: 'plate' }, ['Plate']),
          plateField,
          el('label', { for: 'reg-country' }, ['Registration country']),
          regCountry,
          lookupButton,
        ]),
        plateError,
        plateStatus,
        handButton,
        frameForm,
      ]);

      // ---- scene ----------------------------------------------------------
      let parts: ScenePart[] = buildParts({
        catalogue,
        model: state.manual ? state.model : (catalogue.donors[0]?.model ?? 'K50'),
        packId: state.packId,
        hubId: state.hubId,
      });

      const scene = new SceneView(
        {
          onPartClick: (partId) => selectPart(partId, true),
          onTravel: () => publishClearance(),
          onStop: () => onRailStop(),
          onCameraChange: () => {
            publishCamera();
            publishRows();
            publishClearance();
          },
        },
        'configure',
      );
      scene.setParts(parts);

      const sceneFrame = el('div', { class: 'scene-frame ruled' }, [
        el('div', { class: 'title-block' }, [
          el('span', { 'data-title-donor': '' }, ['Donor']),
          el('span', { 'data-title-kit': '' }, ['Kit']),
          el('span', { 'data-title-class': '' }, ['Road class']),
        ]),
        scene.element,
        scene.handle,
      ]);

      // ---- clearance ------------------------------------------------------
      const slider = el('input', {
        type: 'range',
        class: 'travel-slider',
        'aria-label': 'Insertion travel',
        min: '0',
        max: '210',
        step: '1',
        value: '0',
      });
      const clearanceTable = el('dl', { class: 'clearance-figures' });
      const verdictWord = el('strong', { class: 'verdict-word' });
      const clearance = el(
        'section',
        { class: 'clearance ruled', role: 'region', 'aria-label': 'Clearance', hidden: true },
        [
          el('h2', { class: 'heading-3' }, ['Clearance']),
          slider,
          clearanceTable,
          el('p', { class: 'verdict' }, [verdictWord]),
          verdictStatus,
        ],
      );

      // ---- parts schedule -------------------------------------------------
      const partsList = el('ul', { class: 'parts-list', role: 'list', 'aria-label': 'Parts schedule' });
      const partsSheet = new Panel({ name: 'Parts schedule', variant: 'sheet' });
      const partsSheetButton = el('button', { type: 'button', class: 'parts-sheet-button', 'aria-expanded': 'false' }, [
        'Parts schedule',
      ]);
      partsSheetButton.addEventListener('click', () => partsSheet.open(partsSheetButton));
      const partsColumn = el('section', { class: 'parts-column ruled' }, [
        el('h2', { class: 'heading-3' }, ['Parts schedule']),
        partsList,
      ]);

      // ---- price rail -----------------------------------------------------
      const totalFigure = figure(0, 'quoted');
      const vatFigure = figure(0, 'quoted');
      const linesBody = el('tbody');
      const scheduleBody = el('tbody');
      const noticesList = el('ul', { class: 'notices' });
      const rangeLine = el('p', { class: 'range-line' });

      const packSelect = el('select', { id: 'pack', 'aria-label': 'Pack' });
      for (const pack of catalogue.packs) {
        packSelect.append(
          el('option', { value: pack.id, selected: pack.id === state.packId }, [`${pack.id} ${pack.wattHours} Wh`]),
        );
      }
      const hubSelect = el('select', { id: 'hub', 'aria-label': 'Hub' });
      for (const hub of catalogue.hubs) {
        hubSelect.append(
          el('option', { value: hub.id, selected: hub.id === state.hubId }, [
            `${hub.id} ${tenthsKwToString(hub.powerTenthsKw)} kW`,
          ]),
        );
      }
      const deliveryCountry = el('select', { id: 'delivery-country', 'aria-label': 'Delivery country' });
      for (const code of ['NL', 'BE', 'DE', 'LU']) {
        deliveryCountry.append(el('option', { value: code, selected: state.country === code }, [code]));
      }

      const classGroup = radioGroup('Road class', 'road-class', [
        { value: '25', label: '25 km/h' },
        { value: '45', label: '45 km/h' },
      ], String(state.roadClass), (value) => change({ roadClass: value === '45' ? 45 : 25 }));
      const unitsGroup = radioGroup('Units', 'units', [
        { value: 'metric', label: 'Metric' },
        { value: 'imperial', label: 'Imperial' },
      ], state.units, (value) => change({ units: value as Units }));
      const fulfilmentGroup = radioGroup('Fulfilment', 'fulfilment', [
        { value: 'posted', label: 'Posted' },
        { value: 'workshop', label: 'Fitted at workshop' },
      ], state.fulfilment, (value) => change({ fulfilment: value as ConfigState['fulfilment'] }));

      const startCheckout = el('button', { type: 'button', class: 'primary' }, ['Start checkout']);
      const priceRail = el('section', { class: 'price-rail ruled', role: 'region', 'aria-label': 'Price rail' }, [
        el('h2', { class: 'heading-3' }, ['Price rail']),
        el('div', { class: 'kit-choices grid-fields' }, [
          el('label', { for: 'pack' }, ['Pack']),
          packSelect,
          el('label', { for: 'hub' }, ['Hub']),
          hubSelect,
          el('label', { for: 'delivery-country' }, ['Delivery country']),
          deliveryCountry,
        ]),
        classGroup.element,
        unitsGroup.element,
        fulfilmentGroup.element,
        el('table', { class: 'lines-table' }, [
          el('caption', {}, ['Kit lines']),
          el('thead', {}, [el('tr', {}, [el('th', {}, ['Line']), el('th', {}, ['Gross']), el('th', {}, ['VAT'])])]),
          linesBody,
        ]),
        el('p', { class: 'totals' }, ['Total ', totalFigure.element, ' VAT ', vatFigure.element]),
        rangeLine,
        el('table', { class: 'schedule-table' }, [
          el('caption', {}, ['Payment schedule']),
          el('thead', {}, [el('tr', {}, [el('th', {}, ['Stage']), el('th', {}, ['Amount'])])]),
          scheduleBody,
        ]),
        noticesList,
        figuresStatus,
        startCheckout,
        paymentStatus,
      ]);

      container.append(
        el('div', { class: 'configurator' }, [
          plateBlock,
          el('div', { class: 'scene-area' }, [sceneFrame, clearance]),
          partsColumn,
          partsSheetButton,
          priceRail,
          partsSheet.root,
        ]),
      );

      // ---- parts rows -----------------------------------------------------
      const rowFor = new Map<string, HTMLElement>();

      function renderRows(): void {
        while (partsList.firstChild) partsList.firstChild.remove();
        rowFor.clear();
        for (const [index, part] of parts.entries()) {
          const button = el(
            'button',
            { type: 'button', class: 'part-row', 'data-part-id': part.id, tabindex: index === 0 ? 0 : -1 },
            [el('span', { class: 'part-name' }, [part.name]), el('span', { class: 'part-dim' }, [`${part.dimensionMm.toFixed(1)} mm`])],
          );
          button.addEventListener('click', () => selectPart(part.id, false));
          partsList.append(el('li', {}, [button]));
          rowFor.set(part.id, button);
        }
        publishRows();
      }

      function publishRows(): void {
        for (const part of parts) {
          const row = rowFor.get(part.id);
          if (!row) continue;
          setAttrIfChanged(
            row,
            'data-position-mm',
            `${part.position[0].toFixed(1)},${part.position[1].toFixed(1)},${part.position[2].toFixed(1)}`,
          );
          setAttrIfChanged(row, 'data-panel-fade', scene.panelFade(part.id));
          const point = scene.partScreenPoint(part.id);
          if (point) {
            setAttrIfChanged(row, 'data-screen-x', point.x.toFixed(1));
            setAttrIfChanged(row, 'data-screen-y', point.y.toFixed(1));
          }
        }
      }

      rovingList(partsList, () => qsa<HTMLElement>('.part-row', partsList), (row) => {
        const id = row.dataset.partId;
        if (id) selectPart(id, false);
      });

      // ---- selection and rails -------------------------------------------
      function railSpecFor(name: 'pack' | 'hub'): RailSpec | null {
        if (!fit) return null;
        const rail = name === 'pack' ? fit.rails.pack : fit.rails.hub;
        return {
          name,
          partId: name === 'pack' ? PACK_PART : HUB_PART,
          railMm: Number(rail.railMm),
          stopTravelMm: Number(rail.stopTravelMm),
          foulingFeature: rail.foulingFeature,
          stations: rail.stations.map((station) => ({
            id: station.id,
            name: station.name,
            travelMm: Number(station.travelMm),
            gapMm: station.gapMm === null ? null : Number(station.gapMm),
          })),
        };
      }

      function selectPart(partId: string, fromScene: boolean): void {
        const railName = RAIL_PARTS[partId];
        const spec = railName ? railSpecFor(railName) : null;

        scene.setRail(spec);
        scene.setSelected(partId, { fly: spec !== null });
        clearance.hidden = spec === null;

        if (spec) {
          slider.max = String(spec.railMm);
          slider.value = '0';
          setAttrIfChanged(clearance, 'data-part', partId === PACK_PART ? 'traction-pack' : 'hub-motor');
        }

        for (const row of qsa<HTMLElement>('.part-row', partsList)) {
          const selected = row.dataset.partId === partId;
          row.setAttribute('aria-pressed', selected ? 'true' : 'false');
          row.tabIndex = selected ? 0 : -1;
        }

        publishRows();
        publishClearance();

        // Below 768 px, selecting in the sheet closes it and focus moves on.
        if (partsSheet.isOpen) {
          partsSheet.closeWithoutFocus();
          (spec ? slider : partsSheetButton).focus();
        } else if (!fromScene && window.innerWidth < SHEET_BREAKPOINT && spec) {
          slider.focus();
        }
      }

      function publishCamera(): void {
        const camera = scene.camera3;
        setAttrIfChanged(scene.element, 'data-azimuth-deg', camera.azimuthDeg.toFixed(0));
        setAttrIfChanged(scene.element, 'data-elevation-deg', camera.elevationDeg.toFixed(0));
        setAttrIfChanged(scene.element, 'data-zoom', camera.zoom.toFixed(2));
        setAttrIfChanged(scene.element, 'data-story-offsets', JSON.stringify(scene.storyOffsets()));
      }

      /** The readout publishes travel and station gaps, always in millimetres. */
      function publishClearance(): void {
        const spec = railSpecFor(
          scene.element.dataset.selectedPart === HUB_PART ? 'hub' : 'pack',
        );
        const selected = scene.element.dataset.selectedPart ?? '';
        if (!RAIL_PARTS[selected] || !spec) return;

        const travel = scene.travel;
        slider.value = String(Math.round(travel));
        slider.setAttribute('aria-valuetext', formatLength(Math.round(travel * 10), state.units));

        setAttrIfChanged(clearance, 'data-travel-mm', travel.toFixed(1));
        setAttrIfChanged(clearance, 'data-rail-mm', spec.railMm.toFixed(1));

        let smallest: number | null = null;
        for (const [index, station] of spec.stations.entries()) {
          const reached = travel >= station.travelMm && station.gapMm !== null;
          const value = reached && station.gapMm !== null ? station.gapMm.toFixed(1) : '';
          setAttrIfChanged(clearance, `data-gap-s${index + 1}-mm`, value);
          if (reached && station.gapMm !== null) {
            smallest = smallest === null ? station.gapMm : Math.min(smallest, station.gapMm);
          }
        }
        setAttrIfChanged(clearance, 'data-smallest-gap-mm', smallest === null ? '' : smallest.toFixed(1));

        const atStop = travel >= spec.stopTravelMm;
        const contact = atStop && spec.foulingFeature !== null;
        setAttrIfChanged(clearance, 'data-contact', contact ? 'true' : 'false');
        setAttrIfChanged(clearance, 'data-fouling-feature', contact ? (spec.foulingFeature ?? '') : '');

        const edge = scene.leadingEdge();
        setAttrIfChanged(clearance, 'data-leading-edge-screen-x', edge ? edge.x.toFixed(1) : '');
        setAttrIfChanged(clearance, 'data-leading-edge-screen-y', edge ? edge.y.toFixed(1) : '');
        setAttrIfChanged(clearance, 'data-fouling-screen-x', contact && edge ? edge.x.toFixed(1) : '');
        setAttrIfChanged(clearance, 'data-fouling-screen-y', contact && edge ? edge.y.toFixed(1) : '');

        renderClearanceFigures(spec, travel, smallest);
      }

      function renderClearanceFigures(spec: RailSpec, travel: number, smallest: number | null): void {
        while (clearanceTable.firstChild) clearanceTable.firstChild.remove();
        const add = (label: string, value: string): void => {
          clearanceTable.append(el('dt', {}, [label]), el('dd', { class: 'mono' }, [value]));
        };
        add('Travel', formatLength(Math.round(travel * 10), state.units));
        add('Rail', formatLength(Math.round(spec.railMm * 10), state.units));
        for (const station of spec.stations) {
          const reached = travel >= station.travelMm && station.gapMm !== null;
          add(
            station.name,
            reached && station.gapMm !== null
              ? formatLength(Math.round(station.gapMm * 10), state.units)
              : '—',
          );
        }
        add(
          'Smallest gap',
          smallest === null ? '—' : formatLength(Math.round(smallest * 10), state.units),
        );
      }

      /** Reaching full seat or first contact runs the server fit check. */
      function onRailStop(): void {
        const selected = scene.element.dataset.selectedPart ?? '';
        const railName = RAIL_PARTS[selected];
        if (!railName) return;
        driven[railName] = true;
        updateCheckoutGate();

        const donor = donorBody(state);
        if (!donor) return;
        setTextIfChanged(verdictStatus, 'Checking fit...');
        void api
          .fitCheck({ donor, packId: state.packId, hubId: state.hubId, roadClass: state.roadClass, units: state.units })
          .then((result) => {
            fit = result;
            setTextIfChanged(verdictWord, result.word);
            setTextIfChanged(verdictStatus, result.sentence);
          })
          .catch(() => undefined);
      }

      // ---- slider ---------------------------------------------------------
      slider.addEventListener('input', () => scene.setTravel(Number(slider.value)));
      slider.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 1 : 5;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          scene.setTravel(scene.travel + step);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          scene.setTravel(scene.travel - step);
        } else if (event.key === 'Home') {
          event.preventDefault();
          scene.setTravel(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          const spec = railSpecFor(scene.element.dataset.selectedPart === HUB_PART ? 'hub' : 'pack');
          if (spec) scene.setTravel(spec.stopTravelMm);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          scene.setTravel(0);
          const selected = scene.element.dataset.selectedPart ?? '';
          const row = rowFor.get(selected);
          const narrow = window.innerWidth < SHEET_BREAKPOINT;
          (narrow && !partsSheet.isOpen ? partsSheetButton : (row ?? partsSheetButton)).focus();
        }
      });

      // The scene's Escape moves focus to the selected parts row.
      scene.element.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        const selected = scene.element.dataset.selectedPart ?? '';
        const row = rowFor.get(selected) ?? qsa<HTMLElement>('.part-row', partsList)[0];
        const narrow = window.innerWidth < SHEET_BREAKPOINT;
        (narrow && !partsSheet.isOpen ? partsSheetButton : (row ?? partsSheetButton)).focus();
      });

      bindRailHandle(scene);
      bindTouch(scene);

      // ---- figures --------------------------------------------------------
      function setFigureStatus(word: 'quoted' | 'checking' | 'not current'): void {
        setAttrIfChanged(priceRail, 'data-figures', word);
        for (const node of qsa<HTMLElement>('.status-word', priceRail)) setTextIfChanged(node, word);
        updateCheckoutGate();
      }

      function renderQuote(next: Quote): void {
        quote = next;
        fit = next.fit;

        while (linesBody.firstChild) linesBody.firstChild.remove();
        for (const line of next.lines) {
          const gross = figure(line.grossCents, 'quoted');
          const vat = figure(line.vatCents, 'quoted');
          linesBody.append(
            el('tr', {}, [
              el('th', { scope: 'row' }, [line.name]),
              el('td', {}, [gross.element]),
              el('td', {}, [vat.element]),
            ]),
          );
        }

        while (scheduleBody.firstChild) scheduleBody.firstChild.remove();
        for (const stage of next.schedule) {
          const amount = figure(stage.amountCents, 'scheduled');
          scheduleBody.append(
            el('tr', {}, [el('th', { scope: 'row' }, [stage.label]), el('td', {}, [amount.element])]),
          );
        }

        totalFigure.set(next.totalCents, 'quoted');
        vatFigure.set(next.vatCents, 'quoted');

        while (noticesList.firstChild) noticesList.firstChild.remove();
        for (const notice of next.notices) noticesList.append(el('li', {}, [notice]));

        if (next.fit) {
          setTextIfChanged(verdictWord, next.fit.word);
          setTextIfChanged(verdictStatus, next.fit.sentence);
          setTextIfChanged(rangeLine, `Range ${next.fit.rangeKm} km`);
        }

        setAttrIfChanged(priceRail, 'data-figures', 'quoted');
        for (const node of qsa<HTMLElement>('.status-word', priceRail)) {
          if (node.textContent === 'checking' || node.textContent === 'not current') {
            setTextIfChanged(node, 'quoted');
          }
        }

        setTextIfChanged(
          figuresStatus,
          `Total ${amountText(next.totalCents)} quoted. VAT ${amountText(next.vatCents)}. Range ${next.fit?.rangeKm ?? 0} km.`,
        );
        renderTitleBlock();
        updateCheckoutGate();
      }

      function renderTitleBlock(): void {
        const donorName =
          catalogue.donors.find((row) => row.model === currentModel())?.name ?? currentModel();
        setTextIfChanged(
          sceneFrame.querySelector('[data-title-donor]') as HTMLElement,
          `Donor ${donorName}`,
        );
        setTextIfChanged(
          sceneFrame.querySelector('[data-title-kit]') as HTMLElement,
          `Kit ${state.packId} / ${state.hubId}`,
        );
        setTextIfChanged(
          sceneFrame.querySelector('[data-title-class]') as HTMLElement,
          `Road class ${state.roadClass} km/h`,
        );
      }

      function currentModel(): string {
        if (state.manual) return state.model;
        return lastLookupModel ?? catalogue.donors[0]?.model ?? 'K50';
      }

      let lastLookupModel: string | null = null;

      /** Each change updates figures in place and adds a history entry. */
      function change(patch: Partial<ConfigState>, options: { replace?: boolean } = {}): void {
        const clearsProof =
          patch.packId !== undefined ||
          patch.hubId !== undefined ||
          patch.roadClass !== undefined ||
          patch.plate !== undefined ||
          patch.manual !== undefined ||
          patch.model !== undefined;

        state = { ...state, ...patch };
        if (clearsProof) {
          driven.pack = false;
          driven.hub = false;
        }

        // Each change adds a history entry and updates figures in place.
        context.navigate(writeAddress(state), { silent: true, ...(options.replace ? { replace: true } : {}) });

        if (patch.packId !== undefined || patch.hubId !== undefined || patch.model !== undefined) {
          parts = buildParts({ catalogue, model: currentModel(), packId: state.packId, hubId: state.hubId });
          scene.setParts(parts);
          renderRows();
        }

        void refreshQuote();
      }

      async function refreshQuote(): Promise<void> {
        const donor = donorBody(state);
        if (!donor) {
          setTextIfChanged(figuresStatus, '');
          updateCheckoutGate();
          return;
        }

        const sequence = ++quoteSequence;
        setFigureStatus('checking');
        setTextIfChanged(figuresStatus, CHECKING_FIGURES);

        try {
          const next = await api.quote({
            donor,
            packId: state.packId,
            hubId: state.hubId,
            roadClass: state.roadClass,
            fulfilment: state.fulfilment,
            country: state.country,
            units: state.units,
          });
          // A superseded reply is dropped.
          if (sequence !== quoteSequence) return;
          renderQuote(next);
        } catch (error) {
          if (sequence !== quoteSequence) return;
          if (error instanceof NetworkError || error instanceof ApiCallError) {
            setFigureStatus('not current');
            setTextIfChanged(figuresStatus, FIGURES_STALE);
            return;
          }
          throw error;
        }
      }

      // ---- plate lookup ---------------------------------------------------
      async function lookup(raw: string): Promise<void> {
        const sequence = ++lookupSequence;
        plateError.hidden = true;
        setTextIfChanged(plateStatus, `Looking up ${raw}...`);

        try {
          const found = await api.lookupPlate(raw, state.regCountry);
          if (sequence !== lookupSequence) return;
          lastLookupModel = found.model;
          plateField.value = found.plate;
          setTextIfChanged(
            plateStatus,
            `Found ${found.modelName}, ${found.firstAdmissionYear}, ${found.className}, ${found.plateColour} plate.`,
          );
          frameForm.hidden = true;
          change({
            plate: found.plate,
            manual: false,
            model: found.model,
            regClass: found.roadClass,
            roadClass: Math.max(found.roadClass, state.roadClass) as 25 | 45,
          });
        } catch (error) {
          if (sequence !== lookupSequence) return;
          if (!(error instanceof ApiCallError)) {
            setTextIfChanged(plateStatus, 'No scooter found for that plate.');
            return;
          }
          if (error.errors?.plate) {
            plateError.hidden = false;
            plateError.textContent = error.errors.plate;
            setTextIfChanged(plateStatus, error.errors.plate);
            return;
          }
          if (error.code === 'plate_not_found') {
            setTextIfChanged(plateStatus, 'No scooter found for that plate.');
            return;
          }
          if (error.code === 'registry_unreachable') {
            setTextIfChanged(plateStatus, 'Plate registry unreachable. Your fit stays unconfirmed until it answers.');
          }
        }
      }

      lookupButton.addEventListener('click', () => void lookup(plateField.value));
      plateField.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void lookup(plateField.value);
      });
      regCountry.addEventListener('change', () => {
        state.regCountry = regCountry.value as ConfigState['regCountry'];
      });

      handButton.addEventListener('click', () => {
        frameForm.hidden = false;
        modelSelect.focus();
      });
      frameForm.addEventListener('submit', (event) => {
        event.preventDefault();
        setTextIfChanged(plateStatus, '');
        change({
          manual: true,
          plate: null,
          model: modelSelect.value,
          year: Number(yearField.value),
          regClass: regClassSelect.value === '45' ? 45 : 25,
          colour: colourSelect.value as ConfigState['colour'],
          mass: massField.value,
          roadClass: regClassSelect.value === '45' ? 45 : state.roadClass,
        });
      });

      packSelect.addEventListener('change', () => change({ packId: packSelect.value }));
      hubSelect.addEventListener('change', () => change({ hubId: hubSelect.value }));
      deliveryCountry.addEventListener('change', () =>
        change({ country: deliveryCountry.value as ConfigState['country'] }),
      );

      // ---- checkout -------------------------------------------------------
      function updateCheckoutGate(): void {
        const figuresCurrent = priceRail.dataset.figures === 'quoted';
        const bothDriven = driven.pack && driven.hub;
        const blocked = !figuresCurrent || !bothDriven;
        setMoneyDisabled(startCheckout, blocked, bothDriven ? undefined : RAILS_NOT_DRIVEN);
        if (!bothDriven) setTextIfChanged(paymentStatus, RAILS_NOT_DRIVEN);
        else if (paymentStatus.textContent === RAILS_NOT_DRIVEN) setTextIfChanged(paymentStatus, '');
      }

      startCheckout.addEventListener('click', () => {
        if (startCheckout.getAttribute('aria-disabled') === 'true') return;
        if (!store.user) {
          store.resumeConfiguration = writeAddress(state);
          context.navigate('/sign-in');
          return;
        }
        if (!quote || !fit) return;
        openCheckout({
          opener: startCheckout,
          navigate: context.navigate,
          paymentStatus,
          summary: {
            totalCents: quote.totalCents,
            lines: quote.lines.map((line) => ({ name: line.name, grossCents: line.grossCents })),
            schedule: quote.schedule,
          },
          fit,
          body: {
            kind: 'kit',
            config: {
              donor: donorBody(state),
              packId: state.packId,
              hubId: state.hubId,
              roadClass: state.roadClass,
              fulfilment: state.fulfilment,
              country: state.country,
              units: state.units,
            },
          },
        });
      });

      // ---- layout and motion ---------------------------------------------
      const moveSheet = (): void => {
        const narrow = window.innerWidth < SHEET_BREAKPOINT;
        if (narrow) {
          partsSheet.content.append(partsList);
          partsColumn.hidden = true;
          partsSheetButton.hidden = false;
        } else {
          partsColumn.append(partsList);
          partsColumn.hidden = false;
          partsSheetButton.hidden = true;
        }
      };

      const onResize = (): void => {
        scene.resize();
        publishRows();
        publishClearance();
      };
      const onCross = (): void => {
        if (partsSheet.isOpen) {
          const openerVisible = partsSheetButton.offsetParent !== null;
          partsSheet.closeWithoutFocus();
          const selected = scene.element.dataset.selectedPart ?? '';
          const row = rowFor.get(selected) ?? qsa<HTMLElement>('.part-row', partsList)[0];
          (openerVisible ? partsSheetButton : row)?.focus();
        }
        moveSheet();
        onResize();
      };

      // The published points are viewport coordinates, so scrolling moves them.
      const onScroll = (): void => {
        scene.layoutHandle();
        publishRows();
        publishClearance();
      };
      window.addEventListener('resize', onResize);
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('breakpoint-cross', onCross);
      const stopReduced = onReducedMotionChange(() => scene.draw());

      /**
       * When the registry returns, an open plate address is re-read and its
       * found copy and figures announced, with no reload. A hand-entered donor
       * stays unconfirmed, so it only needs its figures refreshed.
       */
      let registryWasDown = store.status.registry === 'down';
      const stopStatus = store.subscribe(() => {
        const nowDown = store.status.registry === 'down';
        const returned = registryWasDown && !nowDown;
        registryWasDown = nowDown;
        if (returned) {
          if (state.plate && !state.manual) void lookup(state.plate);
          else void refreshQuote();
        }
        // Disabled money controls clear the moment the provider returns.
        updateCheckoutGate();
      });

      detach = [
        () => window.removeEventListener('resize', onResize),
        () => window.removeEventListener('scroll', onScroll),
        () => window.removeEventListener('breakpoint-cross', onCross),
        stopReduced,
        stopStatus,
      ];

      renderRows();
      moveSheet();
      publishCamera();
      setAttrIfChanged(priceRail, 'data-figures', 'checking');
      updateCheckoutGate();

      requestAnimationFrame(() => {
        scene.resize();
        publishRows();
      });

      if (state.plate && !state.manual) await lookup(state.plate);
      else await refreshQuote();
    },

    unmount() {
      for (const stop of detach) stop();
      detach = [];
    },
  };
};

function amountText(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}€${whole}.${String(abs % 100).padStart(2, '0')}`;
}

interface RadioGroup {
  element: HTMLElement;
}

function radioGroup(
  label: string,
  name: string,
  options: { value: string; label: string }[],
  selected: string,
  onChange: (value: string) => void,
): RadioGroup {
  const group = el('fieldset', { class: 'radio-group', role: 'radiogroup', 'aria-label': label }, [
    el('legend', {}, [label]),
  ]);
  for (const option of options) {
    const input = el('input', {
      type: 'radio',
      name,
      id: `${name}-${option.value}`,
      value: option.value,
      checked: option.value === selected,
    });
    input.addEventListener('change', () => {
      if (input.checked) onChange(option.value);
    });
    // The 25 km/h class carries a blue mark and the 45 km/h class a yellow one.
    const classMark =
      option.label === '25 km/h' ? 'class-25' : option.label === '45 km/h' ? 'class-45' : '';
    group.append(
      el('span', { class: `radio ${classMark}`.trim() }, [
        input,
        el('label', { for: `${name}-${option.value}` }, [option.label]),
      ]),
    );
  }
  return { element: group };
}

/** Rail drag begins only on the handle, and moves travel in proportion. */
function bindRailHandle(scene: SceneView): void {
  let dragging = false;
  let startX = 0;
  let startTravel = 0;
  let reachedStop = false;

  scene.handle.addEventListener('pointerdown', (event) => {
    dragging = true;
    reachedStop = false;
    startX = event.clientX;
    startTravel = scene.travel;
    scene.handle.setPointerCapture(event.pointerId);
    event.stopPropagation();
  });
  scene.handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    event.stopPropagation();
    const pixels = scene.drawnRailPixels();
    const railMm = Number(scene.element.dataset.railMm ?? 0);
    const span = railMm > 0 ? railMm : 210;
    const next = startTravel + ((event.clientX - startX) / pixels) * span;
    scene.setTravel(next);
    if (next >= span) reachedStop = true;
  });

  const release = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    event.stopPropagation();
    // Releasing short of contact springs the part back to the rail start.
    if (!reachedStop && scene.travel > 0) scene.springBack();
  };
  scene.handle.addEventListener('pointerup', release);
  scene.handle.addEventListener('pointercancel', (event) => {
    // A cancelled touch springs back too.
    if (!dragging) return;
    dragging = false;
    event.stopPropagation();
    scene.springBack();
  });
}

/**
 * On touch, a horizontal drag orbits and a vertical swipe scrolls the page.
 * The first 10 px of movement decides the axis, and it holds until the finger
 * lifts. A two-finger pinch changes zoom only.
 */
function bindTouch(scene: SceneView): void {
  const AXIS_LOCK_PX = 10;
  let axis: 'none' | 'horizontal' | 'vertical' = 'none';
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let pinchStart: number | null = null;
  let startZoom = 1;

  scene.element.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length === 2) {
        const [a, b] = [event.touches[0] as Touch, event.touches[1] as Touch];
        pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        startZoom = scene.camera3.zoom;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      axis = 'none';
      startX = touch.clientX;
      startY = touch.clientY;
      lastX = touch.clientX;
    },
    { passive: true },
  );

  scene.element.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length === 2 && pinchStart !== null) {
        const [a, b] = [event.touches[0] as Touch, event.touches[1] as Touch];
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const target = startZoom * (distance / pinchStart);
        scene.changeZoom(target - scene.camera3.zoom);
        if (event.cancelable) event.preventDefault();
        return;
      }

      const touch = event.touches[0];
      if (!touch) return;

      if (axis === 'none') {
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);
        if (Math.max(dx, dy) < AXIS_LOCK_PX) return;
        axis = dx >= dy ? 'horizontal' : 'vertical';
      }

      // A vertical swipe scrolls the page and leaves elevation unchanged.
      if (axis === 'vertical') return;

      // Dragging half the scene's width turns about 90 degrees.
      const width = Math.max(1, scene.element.clientWidth);
      scene.orbit(((touch.clientX - lastX) / (width / 2)) * 90, 0);
      lastX = touch.clientX;
      if (event.cancelable) event.preventDefault();
    },
    { passive: false },
  );

  const end = (): void => {
    axis = 'none';
    pinchStart = null;
  };
  scene.element.addEventListener('touchend', end, { passive: true });
  scene.element.addEventListener('touchcancel', end, { passive: true });
}

