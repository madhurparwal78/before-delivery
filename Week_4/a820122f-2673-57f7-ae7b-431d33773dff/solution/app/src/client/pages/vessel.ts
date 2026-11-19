import {
  getJson,
  postJson,
  serverText,
  type ApiErrorBody,
  type ClockChangeRecord,
  type CrewMember,
  type DayEvent,
  type InspectionLink,
  type RotaPlan,
  type RuleSetRecord,
  type StripFix,
  type Vessel,
} from '../api.js';
import { COPY } from '../copy.js';
import {
  button,
  el,
  section,
  selectField,
  setStatus,
  showFieldErrors,
  statusRegion,
  textField,
  wireInternalLink,
} from '../dom.js';
import { openDialog } from '../ui/dialog.js';
import type { Page, PageContext } from '../main.js';

type Loaded = {
  vessel: Vessel;
  crew: CrewMember[];
};

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${Math.floor(absolute / 60)}h${String(absolute % 60).padStart(2, '0')}`;
}

export async function renderVessel(context: PageContext, vesselId: string): Promise<Page> {
  const vessels = await getJson<{ vessels: Vessel[] }>('/api/vessels');
  const vessel = (vessels.ok ? vessels.body.vessels : []).find((item) => item.id === vesselId);
  if (vessel === undefined) {
    return { element: el('div', { class: 'page' }, [el('h1', { text: COPY.pageUnknown })]) };
  }
  const crewResult = await getJson<{ crew: CrewMember[] }>(`/api/vessels/${vesselId}/crew`);
  const loaded: Loaded = { vessel, crew: crewResult.ok ? crewResult.body.crew : [] };

  const crewList = el('ul', { class: 'plain-list' });
  const clockList = el('ul', { class: 'plain-list' });
  const fixList = el('ul', { class: 'plain-list' });
  const ruleSetList = el('ul', { class: 'plain-list' });
  const eventList = el('ul', { class: 'plain-list' });
  const linkList = el('ul', { class: 'plain-list' });
  const planVerdict = statusRegion('Plan verdict');
  const planBreaches = el('ul', { class: 'plain-list' });
  const planBody = el('tbody', {});

  const crewOptions = (): { value: string; label: string }[] =>
    loaded.crew.map((member) => ({ value: member.id, label: `${member.name}, ${member.rank}` }));

  const loadCrew = async (): Promise<void> => {
    const result = await getJson<{ crew: CrewMember[] }>(`/api/vessels/${vesselId}/crew`);
    loaded.crew = result.ok ? result.body.crew : [];
    crewList.replaceChildren(
      ...loaded.crew.map((member) =>
        el('li', {}, [
          el('span', { text: `${member.name}, ${member.rank}, ${member.email} ` }),
          wireInternalLink(
            el('a', { href: `/voyage/${vesselId}/${member.id}` }, [`Review ${member.name}`]),
          ),
        ]),
      ),
    );
    planFor.input.replaceChildren(
      ...crewOptions().map((option) => el('option', { value: option.value, text: option.label })),
    );
  };

  const loadClockChanges = async (): Promise<void> => {
    const result = await getJson<{ clock_changes: ClockChangeRecord[] }>(
      `/api/vessels/${vesselId}/clock-changes`,
    );
    clockList.replaceChildren(
      ...(result.ok ? result.body.clock_changes : []).map((change) =>
        el('li', {}, [
          el('span', {
            text:
              `${change.changes_at_utc}: ${change.label} ${change.kind}, ` +
              `ship's date ${change.ship_date} has ${change.ship_date_cells} cells, ` +
              `offset ${offsetText(change.old_offset_minutes)} to ${offsetText(
                change.new_offset_minutes,
              )}, nautical zone ${change.nautical_zone}`,
          }),
          ...(change.zone_warning ? [el('p', { class: 'warning', text: COPY.zoneWarning })] : []),
        ]),
      ),
    );
  };

  const loadFixes = async (): Promise<void> => {
    const result = await getJson<{ fixes: StripFix[] }>(`/api/vessels/${vesselId}/fixes`);
    fixList.replaceChildren(
      ...(result.ok ? result.body.fixes : []).map((fix) =>
        el('li', {
          text: `${fix.at_utc}: ${fix.latitude.toFixed(2)}, ${fix.longitude.toFixed(2)}`,
        }),
      ),
    );
  };

  const loadRuleSets = async (): Promise<void> => {
    const result = await getJson<{ rule_sets: RuleSetRecord[] }>(
      `/api/vessels/${vesselId}/rule-sets`,
    );
    ruleSetList.replaceChildren(
      ...(result.ok ? result.body.rule_sets : []).map((period) =>
        el('li', {
          text: `Flag exception from ${period.effective_from_utc} until ${period.effective_until_utc}, ${period.flag_reference}`,
        }),
      ),
    );
  };

  const loadLinks = async (): Promise<void> => {
    const result = await getJson<{ links: InspectionLink[] }>(
      `/api/vessels/${vesselId}/inspection-links`,
    );
    linkList.replaceChildren(
      ...(result.ok ? result.body.links : []).map((item) => {
        const address = textField('Link address', `${window.location.origin}${item.url}`);
        address.input.readOnly = true;
        const row = el('li', {}, [
          address.wrapper,
          el('span', {
            class: 'muted',
            text: `${item.from_date} to ${item.to_date}, expires ${item.expires_at_utc}, ${item.state}`,
          }),
        ]);
        if (item.state === 'active') {
          const revoke = button('Revoke link');
          revoke.addEventListener('click', () => {
            void (async () => {
              setStatus(context.feedback, COPY.revokingLink);
              const response = await postJson<ApiErrorBody>(
                `/api/inspection-links/${item.id}/revoke`,
              );
              if (response.ok) setStatus(context.feedback, COPY.linkRevokedFeedback);
              else if (response.status === 409) setStatus(context.feedback, COPY.linkEnded);
              else setStatus(context.feedback, COPY.somethingWrong);
              await loadLinks();
            })();
          });
          const replace = button('Replace link');
          replace.addEventListener('click', () => {
            void (async () => {
              setStatus(context.feedback, COPY.replacingLink);
              const response = await postJson<ApiErrorBody>(
                `/api/inspection-links/${item.id}/regenerate`,
              );
              if (response.ok) setStatus(context.feedback, COPY.linkReplaced);
              else if (response.status === 409) setStatus(context.feedback, COPY.linkEnded);
              else setStatus(context.feedback, COPY.somethingWrong);
              await loadLinks();
            })();
          });
          row.append(el('div', { class: 'actions' }, [revoke, replace]));
        }
        return row;
      }),
    );
  };

  // --- crew -----------------------------------------------------------------
  const addCrew = button('Add crew', { class: 'primary' });
  addCrew.addEventListener('click', () => {
    const name = textField('Name');
    const rank = textField('Rank');
    const email = textField('Email');
    const passcode = textField('Passcode');
    openDialog({
      title: 'Add crew',
      content: [name.wrapper, rank.wrapper, email.wrapper, passcode.wrapper],
      submitLabel: 'Save crew member',
      onSubmit: async () => {
        setStatus(context.feedback, COPY.savingCrew);
        const result = await postJson<ApiErrorBody>(`/api/vessels/${vesselId}/crew`, {
          name: name.input.value,
          rank: rank.input.value,
          email: email.input.value,
          passcode: passcode.input.value,
        });
        if (result.ok) {
          setStatus(context.feedback, COPY.crewSaved);
          await loadCrew();
          return;
        }
        if (result.status === 409) setStatus(context.feedback, COPY.emailTaken);
        else if (result.status === 422) setStatus(context.feedback, serverText(result.body));
        else setStatus(context.feedback, COPY.somethingWrong);
      },
    });
  });

  // --- clock changes --------------------------------------------------------
  const logClockChange = button('Log clock change', { class: 'primary' });
  logClockChange.addEventListener('click', () => {
    const at = textField('Change time in UTC');
    const offset = textField('New offset in minutes');
    const latitude = textField('Latitude');
    const longitude = textField('Longitude');
    openDialog({
      title: 'Log clock change',
      content: [at.wrapper, offset.wrapper, latitude.wrapper, longitude.wrapper],
      submitLabel: 'Save clock change',
      keepOpenOnError: true,
      onSubmit: async () => {
        setStatus(context.feedback, COPY.savingClockChange);
        const result = await postJson<ApiErrorBody>(`/api/vessels/${vesselId}/clock-changes`, {
          changes_at_utc: at.input.value,
          new_offset_minutes: offset.input.value,
          latitude: latitude.input.value,
          longitude: longitude.input.value,
        });
        if (result.ok) {
          setStatus(context.feedback, COPY.clockChangeSaved);
          await loadClockChanges();
          await loadFixes();
          return true;
        }
        if (result.status === 422) {
          setStatus(context.feedback, serverText(result.body));
          const fields = { changes_at_utc: at, new_offset_minutes: offset, latitude, longitude };
          return !showFieldErrors(fields, result.body);
        }
        if (result.status === 409) setStatus(context.feedback, serverText(result.body));
        else setStatus(context.feedback, COPY.somethingWrong);
        return true;
      },
    });
  });

  const addFix = button('Add position fix');
  addFix.addEventListener('click', () => {
    const at = textField('Fix time in UTC');
    const latitude = textField('Latitude');
    const longitude = textField('Longitude');
    openDialog({
      title: 'Add position fix',
      content: [at.wrapper, latitude.wrapper, longitude.wrapper],
      submitLabel: 'Save fix',
      keepOpenOnError: true,
      onSubmit: async () => {
        setStatus(context.feedback, COPY.saving);
        const result = await postJson<ApiErrorBody>(`/api/vessels/${vesselId}/fixes`, {
          at_utc: at.input.value,
          latitude: latitude.input.value,
          longitude: longitude.input.value,
        });
        if (result.ok) {
          setStatus(context.feedback, COPY.saved);
          await loadFixes();
          return true;
        }
        if (result.status === 422) {
          setStatus(context.feedback, serverText(result.body));
          return !showFieldErrors({ at_utc: at, latitude, longitude }, result.body);
        }
        setStatus(context.feedback, COPY.somethingWrong);
        return true;
      },
    });
  });

  // --- rota -----------------------------------------------------------------
  const addWatch = button('Add watch', { class: 'primary' });
  addWatch.addEventListener('click', () => {
    const crew = selectField('Crew member', crewOptions());
    const label = textField('Watch name');
    const start = textField('Start time');
    const end = textField('End time');
    const from = textField("First ship's date");
    const to = textField("Last ship's date");
    openDialog({
      title: 'Add watch',
      content: [crew.wrapper, label.wrapper, start.wrapper, end.wrapper, from.wrapper, to.wrapper],
      submitLabel: 'Save watch',
      keepOpenOnError: true,
      onSubmit: async () => {
        setStatus(context.feedback, COPY.saving);
        const result = await postJson<ApiErrorBody>(`/api/vessels/${vesselId}/rota-watches`, {
          crew_id: crew.input.value,
          label: label.input.value,
          start_time: start.input.value,
          end_time: end.input.value,
          from_date: from.input.value,
          to_date: to.input.value,
        });
        if (result.ok) {
          setStatus(context.feedback, COPY.saved);
          return true;
        }
        if (result.status === 422) {
          setStatus(context.feedback, serverText(result.body));
          const fields = { crew_id: crew, label, start_time: start, end_time: end, from_date: from, to_date: to };
          return !showFieldErrors(fields, result.body);
        }
        setStatus(context.feedback, COPY.somethingWrong);
        return true;
      },
    });
  });

  const planFor = selectField('Plan for', crewOptions());
  const planFrom = textField('Plan from');
  const planTo = textField('Plan to');
  const checkPlan = button('Check plan', { class: 'primary' });
  checkPlan.addEventListener('click', () => {
    void (async () => {
      setStatus(planVerdict, COPY.checkingPlan);
      const result = await getJson<RotaPlan & ApiErrorBody>(
        `/api/vessels/${vesselId}/rota?crew_id=${encodeURIComponent(
          planFor.input.value,
        )}&from=${encodeURIComponent(planFrom.input.value)}&to=${encodeURIComponent(
          planTo.input.value,
        )}`,
      );
      const planFields = { crew_id: planFor, from: planFrom, to: planTo };
      showFieldErrors(planFields, result.status === 422 ? result.body : undefined);
      if (!result.ok) {
        setStatus(
          planVerdict,
          result.status === 422 ? serverText(result.body) : COPY.somethingWrong,
        );
        planBody.replaceChildren();
        planBreaches.replaceChildren();
        return;
      }
      const rows: HTMLElement[] = [];
      for (const day of result.body.days) {
        if (day.watches.length === 0) {
          rows.push(
            el('tr', {}, [
              el('td', { text: day.ship_date }),
              el('td', { text: `${day.day_hours} hours` }),
              el('td', { text: 'No watch' }),
              el('td', { text: '' }),
              el('td', { text: '0' }),
              el('td', { text: String(day.planned_rest_hours) }),
            ]),
          );
          continue;
        }
        day.watches.forEach((watch, index) => {
          rows.push(
            el('tr', {}, [
              el('td', { text: index === 0 ? day.ship_date : '' }),
              el('td', { text: index === 0 ? `${day.day_hours} hours` : '' }),
              el('td', { text: watch.label }),
              el('td', { text: `${watch.start_ship_time} to ${watch.end_ship_time}` }),
              el('td', { text: String(watch.elapsed_hours) }),
              el('td', { text: index === 0 ? String(day.planned_rest_hours) : '' }),
            ]),
          );
        });
      }
      planBody.replaceChildren(...rows);
      const windows = new Map<string, { hours: number; start: string; end: string }>();
      for (const breach of result.body.plan.breaches) {
        windows.set(`${breach.window_hours} ${breach.window_start_utc}`, {
          hours: breach.window_hours,
          start: breach.window_start_utc,
          end: breach.window_end_utc,
        });
      }
      setStatus(
        planVerdict,
        result.body.plan.verdict === 'pass' ? COPY.planPass : COPY.planBreach(windows.size),
      );
      planBreaches.replaceChildren(
        ...[...windows.values()].map((window) =>
          el('li', {
            text: `${window.hours}-hour window from ${window.start} to ${window.end} would breach the rules.`,
          }),
        ),
      );
    })();
  });

  // --- rule sets ------------------------------------------------------------
  const scheduleRuleSet = button('Schedule rule set', { class: 'primary' });
  scheduleRuleSet.addEventListener('click', () => {
    const from = textField('Starts in UTC');
    const until = textField('Ends in UTC');
    const reference = textField('Flag authorisation');
    openDialog({
      title: 'Schedule rule set',
      content: [from.wrapper, until.wrapper, reference.wrapper],
      submitLabel: 'Save rule set',
      onSubmit: async () => {
        setStatus(context.feedback, COPY.schedulingRuleSet);
        const result = await postJson<ApiErrorBody>(`/api/vessels/${vesselId}/rule-sets`, {
          rule_set: 'flag_exception',
          effective_from_utc: from.input.value,
          effective_until_utc: until.input.value,
          flag_reference: reference.input.value,
        });
        if (result.ok) {
          setStatus(context.feedback, COPY.ruleSetScheduled);
          await loadRuleSets();
          return;
        }
        if (result.status === 409 || result.status === 422) {
          setStatus(context.feedback, serverText(result.body));
          return;
        }
        setStatus(context.feedback, COPY.somethingWrong);
      },
    });
  });

  // --- drills and call-outs -------------------------------------------------
  const logEvent = button('Log drill or call-out', { class: 'primary' });
  logEvent.addEventListener('click', () => {
    const crew = selectField('Crew member', crewOptions());
    const kind = selectField('Type', [
      { value: 'drill', label: 'Drill' },
      { value: 'call_out', label: 'Call-out' },
    ]);
    const start = textField('Start in UTC');
    const end = textField('End in UTC');
    const description = textField('What happened');
    openDialog({
      title: 'Log drill or call-out',
      content: [
        crew.wrapper,
        kind.wrapper,
        start.wrapper,
        end.wrapper,
        description.wrapper,
      ],
      submitLabel: 'Save event',
      keepOpenOnError: true,
      onSubmit: async () => {
        setStatus(context.feedback, COPY.saving);
        const result = await postJson<DayEvent & ApiErrorBody>(
          `/api/vessels/${vesselId}/events`,
          {
            crew_id: crew.input.value,
            kind: kind.input.value,
            start_utc: start.input.value,
            end_utc: end.input.value,
            description: description.input.value,
          },
        );
        if (result.ok) {
          setStatus(context.feedback, COPY.saved);
          eventList.append(
            el('li', {
              text: `${result.body.kind} from ${result.body.start_utc} to ${result.body.end_utc}: ${result.body.description}`,
            }),
          );
          return true;
        }
        if (result.status === 422 || result.status === 409) {
          setStatus(context.feedback, serverText(result.body));
          const fields = { crew_id: crew, kind, start_utc: start, end_utc: end, description };
          return result.status === 409 || !showFieldErrors(fields, result.body);
        }
        setStatus(context.feedback, COPY.somethingWrong);
        return true;
      },
    });
  });

  // --- inspection links -----------------------------------------------------
  const shareLink = button('Share with an inspector', { class: 'primary' });
  shareLink.addEventListener('click', () => {
    const from = textField("From ship's date");
    const to = textField("To ship's date");
    const expires = textField('Expires in UTC');
    openDialog({
      title: 'Share with an inspector',
      content: [from.wrapper, to.wrapper, expires.wrapper],
      submitLabel: 'Create link',
      keepOpenOnError: true,
      onSubmit: async () => {
        setStatus(context.feedback, COPY.creatingLink);
        const result = await postJson<ApiErrorBody>(
          `/api/vessels/${vesselId}/inspection-links`,
          {
            from_date: from.input.value,
            to_date: to.input.value,
            expires_at_utc: expires.input.value,
          },
        );
        if (result.ok) {
          setStatus(context.feedback, COPY.linkCreated);
          await loadLinks();
          return true;
        }
        if (result.status === 422) {
          setStatus(context.feedback, serverText(result.body));
          return !showFieldErrors({ from_date: from, to_date: to, expires_at_utc: expires }, result.body);
        }
        setStatus(context.feedback, COPY.somethingWrong);
        return true;
      },
    });
  });

  await loadCrew();
  await loadClockChanges();
  await loadFixes();
  await loadRuleSets();
  await loadLinks();

  const element = el('div', { class: 'page vessel' }, [
    el('h1', { text: vessel.name }),
    el('div', { class: 'vessel-grid' }, [
      section('Crew', [crewList, el('div', { class: 'actions' }, [addCrew])]),
      section('Clock changes', [
        clockList,
        el('h3', { class: 'small-label', text: 'Position fixes' }),
        fixList,
        el('div', { class: 'actions' }, [logClockChange, addFix]),
      ]),
      section('Rota', [
        el('div', { class: 'actions' }, [addWatch]),
        el('div', { class: 'plan-controls' }, [
          planFor.wrapper,
          planFrom.wrapper,
          planTo.wrapper,
          el('div', { class: 'actions' }, [checkPlan]),
        ]),
        el('div', { class: 'scroll-x' }, [
          el('table', { 'aria-label': 'Planned watches' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { scope: 'col', text: "Ship's date" }),
                el('th', { scope: 'col', text: 'Day length' }),
                el('th', { scope: 'col', text: 'Watch' }),
                el('th', { scope: 'col', text: "Ship's time" }),
                el('th', { scope: 'col', text: 'Elapsed hours' }),
                el('th', { scope: 'col', text: 'Planned rest' }),
              ]),
            ]),
            planBody,
          ]),
        ]),
        planVerdict,
        planBreaches,
      ]),
      section('Rule sets', [ruleSetList, el('div', { class: 'actions' }, [scheduleRuleSet])]),
      section('Drills and call-outs', [eventList, el('div', { class: 'actions' }, [logEvent])]),
      section('Inspection links', [linkList, el('div', { class: 'actions' }, [shareLink])]),
    ]),
  ]);
  return { element };
}
