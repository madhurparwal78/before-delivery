import { ApiFailure, Me, api, cachedIdentity, householdPath, loadIdentity, newIdempotencyKey } from '../api';
import { Screen, onLiveEntry, say } from '../app';
import { el, fieldError, isPending, labelled, pendingButton, textbox } from '../dom';
import { formatDisplayDate, formatDmy, parseDmy, splitPercents, lastNightOf, nextDayOf } from '../../../lib/format';
import { PlanRule, VersionBody } from '../../../domain/plan';
import { formatInstant, localMinuteOfDay, minutesToHhMm, parseInstant, wallClockToInstant } from '../../../domain/time';

interface StoredVersionJson extends VersionBody {
  id: string;
  number: number;
  status: 'draft' | 'adopted';
}

const kindLabels: Record<PlanRule['kind'], string> = {
  holiday: 'Holiday',
  school_break: 'School break',
  vacation: 'Vacation',
};

const groupTitles: [PlanRule['kind'], string][] = [
  ['holiday', 'Holidays'],
  ['school_break', 'School breaks'],
  ['vacation', 'Vacations'],
];

function combobox(name: string, options: [string, string][]): HTMLSelectElement {
  const select = el('select', { 'aria-label': name });
  for (const [value, label] of options) select.append(el('option', { value, text: label }));
  return select;
}

function spinbutton(name: string, value: string): HTMLInputElement {
  const input = el('input', { type: 'number', 'aria-label': name, value });
  return input;
}

export function planScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let previewTimer = 0;
  let previewSequence = 0;

  return {
    async mount(main: HTMLElement): Promise<void> {
      const me = (cachedIdentity() ?? (await loadIdentity())) as Me;
      const parentOptions: [string, string][] = [
        ['planning', me.household.planningName],
        ['other', me.household.otherName],
      ];

      let versions: StoredVersionJson[] = [];
      let draft: VersionBody | null = null;
      let draftEtag: string | null = null;
      let draftExists = false;
      let selectedRuleId: string | null = null;

      const effectiveFrom = textbox('Effective from');
      const exchangeTime = textbox('Exchange time');
      const exchangeZone = textbox('Exchange time zone');
      exchangeZone.setAttribute('list', 'zone-list');
      const basePattern = textbox('Base pattern');
      const baseAnchor = textbox('Base anchor');
      const costShare = textbox(`Cost share for ${me.household.planningName} (%)`);
      const otherShare = el('p', { class: 'read-only-share' });
      const runLimit = spinbutton('Most nights in a row', '');
      const saveDraftButton = el('button', { type: 'button', class: 'plain-button', text: 'Save draft' });
      const adoptButton = el('button', { type: 'button', class: 'pill', text: 'Adopt plan' });

      const ruleList = el('div', { role: 'listbox', 'aria-label': 'Rule order', tabindex: '0', class: 'rule-order' });
      const moveUp = el('button', { type: 'button', class: 'plain-button', text: 'Move up' });
      const moveDown = el('button', { type: 'button', class: 'plain-button', text: 'Move down' });

      const ruleName = textbox('Rule name');
      const kindSelect = combobox('Kind', [
        ['holiday', 'Holiday'],
        ['school_break', 'School break'],
        ['vacation', 'Vacation'],
      ]);
      const dateTypeSelect = combobox('Date type', [
        ['fixed', 'Fixed date'],
        ['nth_weekday', 'Weekday of month'],
        ['easter', 'Easter'],
      ]);
      const monthField = spinbutton('Month', '12');
      const dayOfMonth = spinbutton('Day of month', '24');
      const weekdayField = spinbutton('Weekday', '4');
      const weekOfMonth = spinbutton('Week of month', '4');
      const startOffset = spinbutton('Start offset (days)', '0');
      const nightsField = spinbutton('Nights', '1');
      const firstNight = textbox('First night');
      const lastNight = textbox('Last night');
      const oddYears = combobox('Odd years', parentOptions);
      const evenYears = combobox('Even years', parentOptions);
      const splitSelect = combobox('Split', [
        ['halves', 'Halves'],
        ['whole', 'Whole'],
      ]);
      const firstHalfOdd = combobox('First half in odd years', parentOptions);
      const parentSelect = combobox('Parent', parentOptions);
      const vacationTime = textbox('Vacation exchange time');
      const vacationZone = textbox('Vacation exchange zone');
      vacationZone.setAttribute('list', 'zone-list');
      const saveRule = el('button', { type: 'button', class: 'plain-button', text: 'Save rule' });
      const addRule = el('button', { type: 'button', class: 'plain-button', text: 'Add rule' });

      const ruleFields = el('div', { class: 'rule-fields' });
      const editorRegion = el('section', { role: 'region', 'aria-label': 'Rule editor', class: 'card editor-card' }, [
        el('h2', { class: 'card-title', text: 'Rule editor' }),
        labelled('Rule name', ruleName),
        labelled('Kind', kindSelect),
        ruleFields,
        el('div', { class: 'row-actions' }, [saveRule, addRule]),
      ]);

      const previewRegion = el('p', { role: 'status', 'aria-label': 'Plan preview', class: 'preview-line' });
      const versionList = el('ul', { role: 'list', 'aria-label': 'Versions', class: 'version-list' });

      const orderRegion = el('section', { class: 'card order-card' }, [
        el('h2', { class: 'card-title', text: 'Rule order' }),
        ruleList,
        el('div', { class: 'row-actions' }, [moveUp, moveDown]),
      ]);
      const draftRegion = el('section', { class: 'card draft-card' }, [
        el('h2', { class: 'card-title', text: 'Plan' }),
        labelled('Effective from', effectiveFrom),
        labelled('Exchange time', exchangeTime),
        labelled('Exchange time zone', exchangeZone),
        labelled('Base pattern', basePattern),
        labelled('Base anchor', baseAnchor),
        labelled(`Cost share for ${me.household.planningName} (%)`, costShare),
        otherShare,
        labelled('Most nights in a row', runLimit),
        el('div', { class: 'row-actions' }, [saveDraftButton, adoptButton]),
      ]);
      const zoneList = el('datalist', { id: 'zone-list' });
      for (const zone of [
        me.household.zone,
        'UTC',
        'America/St_Johns',
        'America/New_York',
        'Europe/London',
        'Europe/Paris',
        'Australia/Lord_Howe',
        'Pacific/Pago_Pago',
        'Pacific/Apia',
        'Asia/Tokyo',
      ]) {
        zoneList.append(el('option', { value: zone }));
      }
      main.append(
        el('div', { class: 'plan-body' }, [
          orderRegion,
          editorRegion,
          el('section', { class: 'card preview-card' }, [
            el('h2', { class: 'card-title', text: 'Plan preview' }),
            previewRegion,
            el('h2', { class: 'card-title', text: 'Versions' }),
            versionList,
          ]),
          draftRegion,
          zoneList,
        ]),
      );

      function firstExchangeFor(date: string, time: string, zone: string): string | null {
        const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
        if (!match) return null;
        const minuteOfDay = Number.parseInt(match[1] as string, 10) * 60 + Number.parseInt(match[2] as string, 10);
        const resolved = wallClockToInstant(zone, date, minuteOfDay);
        return formatInstant(zone, resolved.epochMs);
      }

      function readDraftFromFields(): VersionBody | null {
        if (!draft) return null;
        const effective = parseDmy(effectiveFrom.value);
        const anchor = parseDmy(baseAnchor.value);
        if (!effective) {
          fieldError(effectiveFrom, 'Enter a real date as DD/MM/YYYY.');
          return null;
        }
        if (!anchor) {
          fieldError(baseAnchor, 'Enter a real date as DD/MM/YYYY.');
          return null;
        }
        const exchange = firstExchangeFor(effective, exchangeTime.value, exchangeZone.value.trim());
        if (!exchange) {
          fieldError(exchangeTime, 'Enter a time as HH:MM.');
          return null;
        }
        const shareText = costShare.value.trim().replace(',', '.');
        const share = Number.parseFloat(shareText);
        if (!Number.isFinite(share) || share < 0 || share > 100) {
          fieldError(costShare, 'Enter a share from 0 to 100 with at most two decimals, using a comma.');
          return null;
        }
        const planningBp = Math.round(share * 100);
        const limitText = runLimit.value.trim();
        return {
          ...draft,
          effectiveFrom: effective,
          exchangeZone: exchangeZone.value.trim(),
          firstExchangeAt: exchange,
          base: { pattern: basePattern.value.trim(), anchor },
          splitBp: { planning: planningBp, other: 10000 - planningBp },
          maxConsecutiveNights: limitText === '' ? null : Number.parseInt(limitText, 10),
        };
      }

      function paintShares(): void {
        const share = Number.parseFloat(costShare.value.trim().replace(',', '.'));
        if (!Number.isFinite(share)) return;
        const [planningPercent, otherPercent] = splitPercents(Math.round(share * 100));
        otherShare.textContent = `${me.household.otherName}: ${otherPercent}% (${me.household.planningName}: ${planningPercent}%)`;
      }

      function paintDraftFields(): void {
        if (!draft) return;
        effectiveFrom.value = draft.effectiveFrom === '' ? '' : formatDmy(draft.effectiveFrom);
        const instant = parseInstant(draft.firstExchangeAt);
        exchangeTime.value =
          instant === null ? '17:00' : minutesToHhMm(localMinuteOfDay(draft.exchangeZone, instant));
        exchangeZone.value = draft.exchangeZone;
        basePattern.value = draft.base.pattern;
        baseAnchor.value = formatDmy(draft.base.anchor);
        costShare.value = String(draft.splitBp.planning / 100).replace('.', ',');
        runLimit.value = draft.maxConsecutiveNights === null ? '' : String(draft.maxConsecutiveNights);
        paintShares();
      }

      function paintRuleOrder(): void {
        ruleList.replaceChildren();
        if (!draft) return;
        for (const [kind, title] of groupTitles) {
          const group = el('div', { role: 'group', 'aria-label': title, class: 'rule-group' }, [
            el('p', { class: 'group-title', text: title }),
          ]);
          for (const rule of draft.rules.filter((candidate) => candidate.kind === kind)) {
            const option = el('div', {
              role: 'option',
              id: `rule-${rule.id}`,
              class: 'rule-option',
              'aria-selected': rule.id === selectedRuleId ? 'true' : 'false',
              text: `${rule.name} (${kindLabels[rule.kind]})`,
            });
            option.addEventListener('click', () => {
              selectedRuleId = rule.id;
              ruleList.setAttribute('aria-activedescendant', `rule-${rule.id}`);
              paintRuleOrder();
              loadRuleIntoEditor(rule);
            });
            group.append(option);
          }
          ruleList.append(group);
        }
        if (selectedRuleId) ruleList.setAttribute('aria-activedescendant', `rule-${selectedRuleId}`);
      }

      function paintVersions(): void {
        versionList.replaceChildren();
        for (const version of versions) {
          versionList.append(
            el('li', {
              role: 'listitem',
              text: `Version ${version.number} — ${version.status === 'draft' ? 'Draft' : 'Adopted'} — ${formatDisplayDate(
                version.effectiveFrom,
              )}`,
            }),
          );
        }
      }

      function paintRuleFields(): void {
        const kind = kindSelect.value as PlanRule['kind'];
        const nodes: HTMLElement[] = [];
        if (kind === 'holiday') {
          nodes.push(labelled('Date type', dateTypeSelect));
          const dateType = dateTypeSelect.value;
          if (dateType === 'fixed') {
            nodes.push(labelled('Month', monthField), labelled('Day of month', dayOfMonth));
          } else if (dateType === 'nth_weekday') {
            nodes.push(labelled('Month', monthField), labelled('Weekday', weekdayField), labelled('Week of month', weekOfMonth));
          }
          nodes.push(
            labelled('Start offset (days)', startOffset),
            labelled('Nights', nightsField),
            labelled('Odd years', oddYears),
            labelled('Even years', evenYears),
          );
        } else if (kind === 'school_break') {
          nodes.push(
            labelled('First night', firstNight),
            labelled('Last night', lastNight),
            labelled('Split', splitSelect),
            labelled('First half in odd years', firstHalfOdd),
          );
        } else {
          nodes.push(
            labelled('First night', firstNight),
            labelled('Last night', lastNight),
            labelled('Parent', parentSelect),
            labelled('Vacation exchange time', vacationTime),
            labelled('Vacation exchange zone', vacationZone),
          );
        }
        ruleFields.replaceChildren(...nodes);
      }

      function loadRuleIntoEditor(rule: PlanRule): void {
        ruleName.value = rule.name;
        kindSelect.value = rule.kind;
        if (rule.kind === 'holiday') {
          dateTypeSelect.value = rule.date.type;
          if (rule.date.type === 'fixed') {
            monthField.value = String(rule.date.month);
            dayOfMonth.value = String(rule.date.day);
          } else if (rule.date.type === 'nth_weekday') {
            monthField.value = String(rule.date.month);
            weekdayField.value = String(rule.date.weekday);
            weekOfMonth.value = String(rule.date.n);
          }
          startOffset.value = String(rule.startOffset);
          nightsField.value = String(rule.nights);
          oddYears.value = rule.oddYears;
          evenYears.value = rule.evenYears;
        } else if (rule.kind === 'school_break') {
          const [start, end] = rule.nights.split('/') as [string, string];
          firstNight.value = formatDmy(start);
          lastNight.value = formatDmy(lastNightOf(end));
          splitSelect.value = rule.split;
          firstHalfOdd.value = rule.firstHalfOddYears;
        } else {
          const [start, end] = rule.nights.split('/') as [string, string];
          firstNight.value = formatDmy(start);
          lastNight.value = formatDmy(lastNightOf(end));
          parentSelect.value = rule.parent;
          const instant = parseInstant(rule.firstExchangeAt);
          vacationTime.value = instant === null ? '17:00' : minutesToHhMm(localMinuteOfDay(rule.exchangeZone, instant));
          vacationZone.value = rule.exchangeZone;
        }
        paintRuleFields();
      }

      function readRuleFromEditor(existingId: string | null): PlanRule | null {
        const name = ruleName.value.trim();
        if (name === '') {
          fieldError(ruleName, 'Use 1 to 80 characters.');
          return null;
        }
        const id =
          existingId ??
          `${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'rule'}`;
        const kind = kindSelect.value as PlanRule['kind'];
        if (kind === 'holiday') {
          const dateType = dateTypeSelect.value;
          const date =
            dateType === 'fixed'
              ? { type: 'fixed' as const, month: Number.parseInt(monthField.value, 10), day: Number.parseInt(dayOfMonth.value, 10) }
              : dateType === 'nth_weekday'
                ? {
                    type: 'nth_weekday' as const,
                    month: Number.parseInt(monthField.value, 10),
                    weekday: Number.parseInt(weekdayField.value, 10),
                    n: Number.parseInt(weekOfMonth.value, 10),
                  }
                : { type: 'easter' as const };
          return {
            id,
            kind,
            name,
            date,
            startOffset: Number.parseInt(startOffset.value, 10),
            nights: Number.parseInt(nightsField.value, 10),
            oddYears: oddYears.value as 'planning' | 'other',
            evenYears: evenYears.value as 'planning' | 'other',
          };
        }
        const start = parseDmy(firstNight.value);
        const end = parseDmy(lastNight.value);
        if (!start) {
          fieldError(firstNight, 'Enter a real date as DD/MM/YYYY.');
          return null;
        }
        if (!end) {
          fieldError(lastNight, 'Enter a real date as DD/MM/YYYY.');
          return null;
        }
        if (kind === 'school_break') {
          return {
            id,
            kind,
            name,
            nights: `${start}/${nextDayOf(end)}`,
            split: splitSelect.value as 'halves' | 'whole',
            firstHalfOddYears: firstHalfOdd.value as 'planning' | 'other',
          };
        }
        const zone = vacationZone.value.trim();
        const exchange = firstExchangeFor(start, vacationTime.value, zone);
        if (!exchange) {
          fieldError(vacationTime, 'Enter a time as HH:MM.');
          return null;
        }
        return {
          id,
          kind,
          name,
          parent: parentSelect.value as 'planning' | 'other',
          nights: `${start}/${nextDayOf(end)}`,
          exchangeZone: zone,
          firstExchangeAt: exchange,
        };
      }

      function showFailure(error: ApiFailure, controls: Record<string, HTMLElement>): void {
        if (error.code === 'precondition_failed') {
          say('This changed while you were looking. It now shows the latest version.');
          void reload();
          return;
        }
        const field = error.firstFieldError;
        if (field) {
          const control =
            controls[field.field] ??
            Object.entries(controls).find(([name]) => field.field.startsWith(name))?.[1] ??
            null;
          if (control) {
            fieldError(control, field.message);
            control.focus();
          }
          say(field.message);
          return;
        }
        say(error.problem.title);
      }

      const draftControls: Record<string, HTMLElement> = {
        effectiveFrom,
        exchangeZone,
        firstExchangeAt: exchangeTime,
        'base.pattern': basePattern,
        'base.anchor': baseAnchor,
        splitBp: costShare,
        maxConsecutiveNights: runLimit,
        rules: ruleName,
      };

      async function writeDraft(body: VersionBody, onDone?: () => void): Promise<boolean> {
        try {
          const result = await api<StoredVersionJson>('PUT', householdPath('/plan/draft'), {
            json: body,
            ...(draftExists ? { ifMatch: draftEtag ?? undefined } : { ifNoneMatch: '*' }),
          });
          draft = { ...body };
          draftEtag = result.etag;
          draftExists = true;
          onDone?.();
          return true;
        } catch (error) {
          if (error instanceof ApiFailure) showFailure(error, draftControls);
          return false;
        }
      }

      async function reload(): Promise<void> {
        const result = await api<{ versions: StoredVersionJson[] }>('GET', householdPath('/plan'));
        versions = result.data.versions;
        const stored = versions.find((version) => version.status === 'draft') ?? null;
        draftExists = stored !== null;
        draftEtag = result.etag ?? null;
        if (stored) {
          draft = {
            effectiveFrom: stored.effectiveFrom,
            exchangeZone: stored.exchangeZone,
            firstExchangeAt: stored.firstExchangeAt,
            base: stored.base,
            splitBp: stored.splitBp,
            maxConsecutiveNights: stored.maxConsecutiveNights,
            rules: stored.rules,
          };
        } else {
          const newest = versions.find((version) => version.status === 'adopted') ?? null;
          draft = newest
            ? {
                effectiveFrom: '',
                exchangeZone: newest.exchangeZone,
                firstExchangeAt: newest.firstExchangeAt,
                base: newest.base,
                splitBp: newest.splitBp,
                maxConsecutiveNights: newest.maxConsecutiveNights,
                rules: newest.rules,
              }
            : {
                effectiveFrom: me.household.today,
                exchangeZone: me.household.zone,
                firstExchangeAt:
                  firstExchangeFor(me.household.today, '17:00', me.household.zone) ??
                  `${me.household.today}T17:00:00+00:00`,
                base: { pattern: 'PO', anchor: me.household.today },
                splitBp: { planning: 5000, other: 5000 },
                maxConsecutiveNights: null,
                rules: [],
              };
        }
        if (versions.length === 0) previewRegion.textContent = 'No plan yet.';
        paintDraftFields();
        paintRuleOrder();
        paintVersions();
        paintRuleFields();
        requestPreview();
      }

      function requestPreview(): void {
        window.clearTimeout(previewTimer);
        previewTimer = window.setTimeout(() => {
          void runPreview();
        }, 250);
      }

      async function runPreview(): Promise<void> {
        const edited = draft ? readDraftFromFields() ?? draft : null;
        const newest = versions.find((version) => version.status === 'adopted') ?? null;
        const body =
          edited && edited.effectiveFrom !== ''
            ? edited
            : newest
              ? {
                  effectiveFrom: newest.effectiveFrom,
                  exchangeZone: newest.exchangeZone,
                  firstExchangeAt: newest.firstExchangeAt,
                  base: newest.base,
                  splitBp: newest.splitBp,
                  maxConsecutiveNights: newest.maxConsecutiveNights,
                  rules: newest.rules,
                }
              : null;
        if (!body) return;
        const sequence = ++previewSequence;
        const adopted = versions.some((version) => version.status === 'adopted');
        const year = adopted
          ? Number.parseInt(me.household.today.slice(0, 4), 10)
          : Number.parseInt(body.effectiveFrom.slice(0, 4), 10);
        try {
          const result = await api<{ year: number; nights: { planning: number; other: number } }>(
            'POST',
            householdPath(`/plan/preview?year=${year}`),
            { json: body },
          );
          if (sequence !== previewSequence) return;
          previewRegion.textContent =
            `${me.household.planningName}: ${result.data.nights.planning} nights, ` +
            `${me.household.otherName}: ${result.data.nights.other} nights in ${result.data.year}`;
        } catch (error) {
          if (sequence !== previewSequence) return;
          if (error instanceof ApiFailure) {
            const field = error.firstFieldError;
            if (field) previewRegion.textContent = field.message;
          }
        }
      }

      for (const control of [effectiveFrom, exchangeTime, exchangeZone, basePattern, baseAnchor, costShare, runLimit]) {
        control.addEventListener('input', () => {
          fieldError(control, null);
          paintShares();
          requestPreview();
        });
      }
      kindSelect.addEventListener('change', paintRuleFields);
      dateTypeSelect.addEventListener('change', paintRuleFields);

      saveDraftButton.addEventListener('click', () => {
        if (isPending(saveDraftButton)) return;
        const body = readDraftFromFields();
        if (!body) return;
        pendingButton(saveDraftButton, true, 'Saving...');
        void writeDraft(body, () => say('Draft saved.'))
          .then(() => reload())
          .finally(() => pendingButton(saveDraftButton, false, ''));
      });

      adoptButton.addEventListener('click', () => {
        if (isPending(adoptButton)) return;
        void (async () => {
          pendingButton(adoptButton, true, 'Adopting...');
          const body = readDraftFromFields();
          try {
            if (body && !(await writeDraft(body))) return;
            const result = await api<StoredVersionJson>('POST', householdPath('/plan/draft/adopt'), {
              ifMatch: draftEtag ?? undefined,
              idempotencyKey: newIdempotencyKey(),
            });
            if (result.data.number === 1) say('Plan adopted. The calendar now uses it.');
            else say(`Amendment recorded. It applies from ${formatDisplayDate(result.data.effectiveFrom)}.`);
            await loadIdentity();
            await reload();
          } catch (error) {
            if (error instanceof ApiFailure) {
              if (error.code === 'costs_logged_after_effective_date') {
                say('Costs are already sent on or after that date. Choose a later date.');
                fieldError(effectiveFrom, 'Costs are already sent on or after that date. Choose a later date.');
              } else {
                showFailure(error, draftControls);
              }
            }
          } finally {
            pendingButton(adoptButton, false, '');
          }
        })();
      });

      addRule.addEventListener('click', () => {
        if (!draft || isPending(addRule)) return;
        fieldError(ruleName, null);
        const rule = readRuleFromEditor(null);
        if (!rule) return;
        const body = readDraftFromFields() ?? draft;
        const next = { ...body, rules: [...body.rules, rule] };
        pendingButton(addRule, true, 'Adding...');
        void writeDraft(next, () => {
          selectedRuleId = rule.id;
          say('Draft saved.');
        })
          .then(() => reload())
          .finally(() => pendingButton(addRule, false, ''));
      });

      saveRule.addEventListener('click', () => {
        if (!draft || !selectedRuleId || isPending(saveRule)) return;
        fieldError(ruleName, null);
        const rule = readRuleFromEditor(selectedRuleId);
        if (!rule) return;
        const body = readDraftFromFields() ?? draft;
        const next = {
          ...body,
          rules: body.rules.map((candidate) => (candidate.id === selectedRuleId ? rule : candidate)),
        };
        pendingButton(saveRule, true, 'Saving...');
        void writeDraft(next, () => say('Draft saved.'))
          .then(() => reload())
          .finally(() => pendingButton(saveRule, false, ''));
      });

      let moveChain: Promise<void> = Promise.resolve();

      function moveSelected(direction: -1 | 1): void {
        if (!draft || !selectedRuleId) return;
        const ruleId = selectedRuleId;
        moveChain = moveChain.then(async () => {
          if (!draft) return;
          const rules = [...draft.rules];
          const index = rules.findIndex((rule) => rule.id === ruleId);
          if (index < 0) return;
          const rule = rules[index] as PlanRule;
          const sameKind = rules.filter((candidate) => candidate.kind === rule.kind);
          const positionInKind = sameKind.findIndex((candidate) => candidate.id === ruleId);
          if (positionInKind + direction < 0 || positionInKind + direction >= sameKind.length) {
            say('A rule moves only within its own kind.');
            return;
          }
          const neighbour = sameKind[positionInKind + direction] as PlanRule;
          const neighbourIndex = rules.findIndex((candidate) => candidate.id === neighbour.id);
          rules[index] = neighbour;
          rules[neighbourIndex] = rule;
          const body = { ...draft, rules };
          try {
            const result = await api<StoredVersionJson>('PUT', householdPath('/plan/draft'), {
              json: body,
              ...(draftExists ? { ifMatch: draftEtag ?? undefined } : { ifNoneMatch: '*' }),
            });
            draft = body;
            draftEtag = result.etag;
            draftExists = true;
            paintRuleOrder();
            const option = ruleList.querySelector<HTMLElement>(`#rule-${ruleId}`);
            option?.scrollIntoView({ block: 'nearest' });
            requestPreview();
          } catch (error) {
            if (error instanceof ApiFailure && error.code === 'precondition_failed') {
              await reload();
              say('This changed while you were looking. It now shows the latest version.');
              ruleList.focus();
            } else if (error instanceof ApiFailure) {
              showFailure(error, draftControls);
            }
          }
        });
      }

      moveUp.addEventListener('click', () => moveSelected(-1));
      moveDown.addEventListener('click', () => moveSelected(1));
      ruleList.addEventListener('keydown', (event) => {
        if (!draft) return;
        const ids = draft.rules.map((rule) => rule.id);
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          moveSelected(event.key === 'ArrowUp' ? -1 : 1);
          return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const position = selectedRuleId ? ids.indexOf(selectedRuleId) : -1;
          const next = Math.max(0, Math.min(ids.length - 1, position + (event.key === 'ArrowUp' ? -1 : 1)));
          selectedRuleId = ids[next] ?? null;
          paintRuleOrder();
          const rule = draft.rules.find((candidate) => candidate.id === selectedRuleId);
          if (rule) loadRuleIntoEditor(rule);
        }
      });

      await reload();
      ruleName.focus();
      stopLive = onLiveEntry((entry) => {
        if (entry.type.startsWith('plan.')) void reload();
      });

      this.dispose = (): void => {
        window.clearTimeout(previewTimer);
        stopLive?.();
      };
    },
  };
}
