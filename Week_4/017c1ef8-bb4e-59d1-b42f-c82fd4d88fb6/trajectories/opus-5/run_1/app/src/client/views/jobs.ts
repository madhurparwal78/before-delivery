import { formatDateTime, wallTimeToUtc, WORKPLACE_LABELS } from '../../shared/format';
import { api, newIdempotencyKey } from '../api';
import { announce, clearAlerts, dialog, h, qs, showAlert } from '../dom';
import { timeElement } from '../components/text';
import { personCardNode, type PersonCard } from '../components/person';
import { cfg, on } from '../state';
import { S } from '../strings';

export type JobCard = {
  id: string;
  title: string;
  company: { id: string; name: string; handle: string };
  location: string;
  workplace: string;
  posted_at: string;
  closes_at: string;
  open: boolean;
  saved: boolean;
  applied: boolean;
};

type Question = {
  id: string;
  type: string;
  text: string;
  required: boolean;
  options: string[] | null;
};

type Application = {
  id: string;
  job: { id: string; title: string };
  state: string;
  status_text: string;
  history: { state: string; status_text: string; at: string; by: string; reason: string | null }[];
};

type JobDetail = JobCard & {
  description: string;
  questions: Question[];
  stages: { state: string; label: string; status_text: string; moved_by: string }[];
  my_application: { id: string; state: string; status_text: string } | null;
};

function jobCardNode(job: JobCard): HTMLElement {
  return h('li', { class: 'job-card', 'data-job-id': job.id }, [
    h('a', { href: `/jobs/${job.id}`, class: 'person-name' }, [job.title]),
    h('p', { class: 'muted', text: job.company.name }),
    h('p', { class: 'muted', text: job.location }),
    h('p', { class: 'muted', text: WORKPLACE_LABELS[job.workplace] ?? job.workplace }),
    timeElement(job.posted_at),
  ]);
}

export function jobsSearchView(): HTMLElement {
  const host = h('div', { class: 'narrow' });
  const location = h('input', {
    type: 'text',
    'aria-label': 'Location',
    class: 'input',
    input: () => void load(),
  }) as HTMLInputElement;
  const workplace = h(
    'select',
    { 'aria-label': 'Workplace', class: 'input', change: () => void load() },
    [
      h('option', { value: '' }, ['Any']),
      h('option', { value: 'on-site' }, ['On-site']),
      h('option', { value: 'hybrid' }, ['Hybrid']),
      h('option', { value: 'remote' }, ['Remote']),
    ],
  ) as HTMLSelectElement;
  const posted = h(
    'select',
    { 'aria-label': 'Date posted', class: 'input', change: () => void load() },
    [
      h('option', { value: '' }, ['Any time']),
      h('option', { value: 'day' }, ['Past 24 hours']),
      h('option', { value: 'week' }, ['Past week']),
      h('option', { value: 'month' }, ['Past month']),
    ],
  ) as HTMLSelectElement;
  const results = h('ul', { class: 'card-list' });
  const count = h('p', { role: 'status', 'aria-label': 'Search results', class: 'tabular' });

  host.append(
    h('h1', { class: 'page-title', text: 'Jobs' }),
    h('div', { class: 'filters' }, [location, workplace, posted]),
    count,
    results,
    h('a', { href: '/my-jobs', class: 'link underline' }, ['My jobs']),
  );
  void load();
  return host;

  async function load(): Promise<void> {
    const params = new URLSearchParams({ type: 'jobs', q: '' });
    if (location.value) params.set('location', location.value);
    if (workplace.value) params.set('workplace', workplace.value);
    if (posted.value) params.set('posted', posted.value);
    const result = await api.get<{ total: number; results: JobCard[] }>(
      `/api/search?${params.toString()}`,
    );
    if (!result.ok) {
      count.textContent = S.empty.searchFailed;
      return;
    }
    count.textContent = S.search.count(result.body.total, '');
    results.replaceChildren();
    for (const job of result.body.results) results.append(jobCardNode(job));
  }
}

export function jobView(jobId: string): HTMLElement {
  const host = h('div', { class: 'narrow' });
  let closesAt = 0;
  let shownOpen = true;
  void load();
  /* The server re-checks time-based states each second, so a job closes here too. */
  const off = on('tick', (data) => {
    if (!document.contains(host) || closesAt === 0) return;
    const nowMs = Date.parse(String(data.now));
    if (shownOpen && nowMs >= closesAt) void load();
  });
  const offField = on('job_field', (data) => {
    if (String(data.job_id) === jobId && document.contains(host)) void load();
  });
  const offClock = on('clock', () => {
    if (document.contains(host)) void load();
  });
  const offApp = on('application', (data) => {
    if (String(data.job_id) === jobId && document.contains(host)) void load();
  });
  const observer = new MutationObserver(() => {
    if (!document.contains(host)) {
      off();
      offField();
      offClock();
      offApp();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return host;

  async function load(): Promise<void> {
    const result = await api.get<JobDetail>(`/api/jobs/${jobId}`);
    if (!result.ok) {
      host.replaceChildren(
        h('div', { class: 'empty' }, [
          h('h1', { class: 'big-sentence', text: S.empty.unknownAddress }),
          h('a', { href: '/jobs', class: 'link underline' }, ['Go to Home']),
        ]),
      );
      return;
    }
    const job = result.body;
    closesAt = Date.parse(job.closes_at);
    shownOpen = job.open;
    const stages = h('ul', { 'aria-label': 'Hiring stages', class: 'plain-list' });
    for (const stage of job.stages) {
      const who =
        stage.moved_by === 'applicant'
          ? 'the applicant'
          : stage.moved_by === 'poster'
            ? 'the hiring team'
            : 'automatically when the hiring team first opens it';
      stages.append(
        h('li', { text: `${stage.label} · ${stage.status_text} · Moved by ${who}` }),
      );
    }

    const saveButton = h(
      'button',
      {
        type: 'button',
        class: 'button quiet',
        'aria-pressed': job.saved ? 'true' : 'false',
        click: async () => {
          const result2 = job.saved
            ? await api.del(`/api/jobs/${jobId}/save`)
            : await api.put(`/api/jobs/${jobId}/save`);
          if (result2.ok) {
            announce(
              'Jobs announcements',
              job.saved ? S.announce.jobUnsaved : S.announce.jobSaved,
            );
            void load();
          } else showAlert(host, S.alert.somethingWrong);
        },
      },
      [job.saved ? 'Saved' : 'Save job'],
    );

    const actions = h('div', { class: 'action-row' }, [saveButton]);
    if (!job.open) {
      actions.append(h('p', { class: 'big-sentence small', text: S.jobs.closed }));
    } else if (job.my_application) {
      actions.append(h('p', { class: 'muted', text: job.my_application.status_text }));
    } else {
      const apply = h(
        'button',
        { type: 'button', class: 'button', click: () => openApplyDialog(job, apply) },
        ['Apply'],
      );
      actions.append(apply);
    }

    host.replaceChildren(
      h('h1', { class: 'page-title', text: job.title }),
      h('a', { href: `/company/${job.company.handle}`, class: 'link' }, [job.company.name]),
      h('p', { class: 'muted', text: `${job.location} · ${WORKPLACE_LABELS[job.workplace]}` }),
      h('p', {
        class: 'muted',
        text: `Closes ${formatDateTime(new Date(job.closes_at), cfg().time_zone)}`,
      }),
      h('p', { class: 'body-text', text: job.description }),
      actions,
      h('h2', { class: 'section-title', text: 'Hiring stages' }),
      stages,
    );
  }

  function openApplyDialog(job: JobDetail, opener: HTMLElement): void {
    let resumeId: string | null = null;
    dialog(
      `Apply to ${job.title}`,
      (close) => {
        const body = h('div', { class: 'dialog-body' });
        const submit = h('button', { type: 'button', class: 'button', disabled: true }, [
          'Submit application',
        ]);
        const file = h('input', {
          type: 'file',
          'aria-label': 'Resume (PDF)',
          accept: 'application/pdf',
          class: 'input',
          change: async () => {
            const chosen = file.files?.[0];
            if (!chosen) return;
            clearAlerts(body);
            announce('Jobs announcements', S.announce.uploading);
            const upload = await api.upload<{ resume_id: string; error?: string; limit?: number }>(
              '/api/uploads/resume',
              chosen,
            );
            if (upload.ok) {
              resumeId = upload.body.resume_id;
              submit.removeAttribute('disabled');
              announce('Jobs announcements', S.announce.resumeAttached);
              return;
            }
            resumeId = null;
            submit.setAttribute('disabled', '');
            showAlert(
              body,
              upload.body.error === 'resume_type'
                ? S.alert.resumeWrongType
                : upload.body.error === 'resume_too_large'
                  ? S.alert.resumeTooLarge(upload.body.limit ?? cfg().resume_max_bytes)
                  : upload.body.error === 'storage_unavailable'
                    ? S.alert.storageUnreachable
                    : S.alert.somethingWrong,
            );
          },
        }) as HTMLInputElement;
        body.append(file);

        const controls = new Map<string, () => unknown>();
        for (const question of job.questions) {
          const wrap = h('div', { class: 'question', 'data-question-id': question.id });
          if (question.type === 'short_answer') {
            const input = h('input', {
              type: 'text',
              'aria-label': question.text,
              class: 'input',
            }) as HTMLInputElement;
            wrap.append(h('p', { text: question.text }), input);
            controls.set(question.id, () => input.value);
          } else if (question.type === 'number') {
            const input = h('input', {
              type: 'number',
              'aria-label': question.text,
              class: 'input',
            }) as HTMLInputElement;
            wrap.append(h('p', { text: question.text }), input);
            controls.set(question.id, () => (input.value === '' ? null : Number(input.value)));
          } else {
            const options =
              question.type === 'yes_no'
                ? [
                    ['yes', 'Yes'],
                    ['no', 'No'],
                  ]
                : (question.options ?? []).map((option) => [option, option]);
            const group = h('div', {
              role: 'radiogroup',
              'aria-label': question.text,
              class: 'radiogroup',
            });
            group.append(h('p', { text: question.text }));
            const inputs: HTMLInputElement[] = [];
            for (const [value, label] of options) {
              const radio = h('input', {
                type: 'radio',
                name: `q-${question.id}`,
                'aria-label': label,
                value,
                class: 'radio',
              }) as HTMLInputElement;
              inputs.push(radio);
              group.append(h('label', { class: 'field inline' }, [radio, h('span', { text: label })]));
            }
            wrap.append(group);
            controls.set(
              question.id,
              () => inputs.find((input) => input.checked)?.value ?? null,
            );
          }
          body.append(wrap);
        }

        submit.addEventListener('click', async () => {
          clearAlerts(body);
          submit.setAttribute('disabled', '');
          const answers: Record<string, unknown> = {};
          for (const [id, read] of controls) {
            const value = read();
            if (value !== null && value !== '') answers[id] = value;
          }
          const result = await api.post<{
            error?: string;
            fields?: Record<string, string>;
          }>(
            `/api/jobs/${job.id}/applications`,
            { resume_id: resumeId, answers },
            { 'Idempotency-Key': newIdempotencyKey() },
          );
          if (result.ok) {
            announce('Jobs announcements', S.announce.applicationSubmitted);
            close();
            void load();
            return;
          }
          submit.removeAttribute('disabled');
          announce('Jobs announcements', S.announce.applicationNotSubmitted);
          if (result.body.error === 'already_applied') {
            showAlert(body, S.alert.alreadyApplied);
            return;
          }
          if (result.body.error === 'job_closed') {
            showAlert(body, S.alert.jobClosedWhileApplying);
            return;
          }
          const fields = result.body.fields ?? {};
          let firstControl: HTMLElement | null = null;
          for (const [key, message] of Object.entries(fields)) {
            const questionId = key.startsWith('answers.') ? key.slice('answers.'.length) : null;
            const wrap = questionId
              ? qs<HTMLElement>(`[data-question-id="${questionId}"]`, body)
              : null;
            if (wrap) {
              showAlert(wrap, message);
              if (!firstControl) {
                firstControl = qs<HTMLElement>('input, select, textarea', wrap);
              }
            } else showAlert(body, message);
          }
          if (firstControl) firstControl.focus();
        });

        return [h('h2', { text: `Apply to ${job.title}` }), body, submit];
      },
      opener,
    );
  }
}

export function myJobsView(): HTMLElement {
  const host = h('div', { class: 'narrow' });
  let tab: 'saved' | 'applied' = 'saved';
  void draw();
  const off = on('application', () => {
    if (!document.contains(host)) {
      off();
      return;
    }
    if (tab === 'applied') void draw(true);
  });
  return host;

  async function draw(announceChange = false): Promise<void> {
    const result = await api.get<{ jobs: (JobCard & { my_application: Application | null })[] }>(
      `/api/me/jobs?tab=${tab}`,
    );
    const tablist = h('div', { role: 'tablist', 'aria-label': 'My jobs', class: 'tablist' }, [
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': tab === 'saved' ? 'true' : 'false',
          class: 'tab',
          click: () => {
            tab = 'saved';
            void draw();
          },
        },
        ['Saved'],
      ),
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': tab === 'applied' ? 'true' : 'false',
          class: 'tab',
          click: () => {
            tab = 'applied';
            void draw();
          },
        },
        ['Applied'],
      ),
    ]);
    host.replaceChildren(h('h1', { class: 'page-title', text: 'My jobs' }), tablist);
    const jobs = result.ok ? result.body.jobs : [];
    if (jobs.length === 0) {
      host.append(
        h('div', { class: 'empty' }, [
          h('p', {
            class: 'big-sentence',
            text: tab === 'saved' ? S.empty.savedJobs : S.empty.applications,
          }),
          h('a', { href: '/jobs', class: 'link underline' }, ['Search jobs']),
        ]),
      );
      return;
    }
    const list = h('ul', { class: 'card-list' });
    for (const job of jobs) {
      if (tab === 'saved') {
        list.append(jobCardNode(job));
        continue;
      }
      const application = job.my_application;
      if (!application) continue;
      const item = h('li', {
        class: 'job-card',
        'data-application-id': application.id,
        'data-state': application.state,
      });
      const history = h('ul', {
        'aria-label': `History for ${job.title}`,
        class: 'plain-list',
      });
      for (const entry of application.history) {
        const who =
          entry.by === 'you'
            ? 'You'
            : entry.by === 'hiring_team'
              ? 'Hiring team'
              : `Automatic: ${entry.reason ?? ''}`;
        history.append(
          h('li', {
            text: `${entry.status_text} · ${formatDateTime(new Date(entry.at), cfg().time_zone)} · ${who}`,
          }),
        );
      }
      item.append(
        h('a', { href: `/jobs/${job.id}`, class: 'person-name' }, [job.title]),
        h('p', { class: 'muted', text: job.company.name }),
        h('p', { class: 'status-text', text: application.status_text }),
        history,
      );
      if (['applied', 'viewed', 'interviewing'].includes(application.state)) {
        const withdraw = h(
          'button',
          {
            type: 'button',
            class: 'button quiet',
            click: () =>
              dialog(
                'Withdraw application?',
                (close) => [
                  h('h2', { text: 'Withdraw application?' }),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'button',
                      click: async () => {
                        await api.post(`/api/applications/${application.id}/transition`, {
                          to: 'withdrawn',
                        });
                        close();
                        void draw();
                      },
                    },
                    ['Withdraw'],
                  ),
                  h('button', { type: 'button', class: 'button quiet', click: () => close() }, [
                    'Cancel',
                  ]),
                ],
                withdraw,
              ),
          },
          ['Withdraw application'],
        );
        item.append(withdraw);
      }
      list.append(item);
      if (announceChange) {
        announce(
          'Jobs announcements',
          S.announce.applicationStatus(job.title, application.status_text),
        );
      }
    }
    host.append(list);
  }
}

export function companyView(handle: string): HTMLElement {
  const host = h('div', { class: 'narrow' });
  void load();
  return host;

  async function load(): Promise<void> {
    const result = await api.get<{
      id: string;
      handle: string;
      name: string;
      location: string;
      about: string;
      follower_count: number;
      following: boolean;
      is_admin: boolean;
      open_jobs: JobCard[];
    }>(`/api/companies/${encodeURIComponent(handle)}`);
    if (!result.ok) {
      host.replaceChildren(
        h('div', { class: 'empty' }, [
          h('h1', { class: 'big-sentence', text: S.empty.unknownAddress }),
          h('a', { href: '/feed', class: 'link underline' }, ['Go to Home']),
        ]),
      );
      return;
    }
    const company = result.body;
    const jobs = h('ul', { class: 'card-list' });
    for (const job of company.open_jobs) {
      const item = jobCardNode(job);
      if (company.is_admin) {
        item.append(
          h('a', { href: `/jobs/${job.id}/edit`, class: 'link underline' }, ['Edit job']),
          h('a', { href: `/jobs/${job.id}/applicants`, class: 'link underline' }, ['Applicants']),
        );
      }
      jobs.append(item);
    }

    const follow = h(
      'button',
      {
        type: 'button',
        class: 'button quiet',
        'aria-pressed': company.following ? 'true' : 'false',
        click: async () => {
          const response = company.following
            ? await api.del(`/api/follows/${company.id}`)
            : await api.post('/api/follows', { target_id: company.id });
          if (response.ok) void load();
        },
      },
      [company.following ? 'Following' : 'Follow'],
    );

    const actions = h('div', { class: 'action-row' }, [follow]);
    if (company.is_admin) {
      const postJob = h(
        'button',
        { type: 'button', class: 'button', click: () => openPostJobDialog(company.id, postJob) },
        ['Post a job'],
      );
      const editPage = h(
        'button',
        { type: 'button', class: 'button quiet', click: () => openEditPageDialog(company, editPage) },
        ['Edit page'],
      );
      actions.append(postJob, editPage);
    }

    host.replaceChildren(
      h('h1', { class: 'page-title', text: company.name }),
      h('p', { class: 'muted', text: company.location }),
      h('p', {
        class: 'count tabular',
        text: company.follower_count === 1 ? '1 follower' : `${company.follower_count} followers`,
      }),
      h('p', { class: 'body-text', text: company.about }),
      actions,
      h('h2', { class: 'section-title', text: 'Open jobs' }),
      jobs,
    );

    if (company.is_admin) {
      const followers = await api.get<{ followers: PersonCard[] }>(
        `/api/companies/${encodeURIComponent(handle)}/followers`,
      );
      if (followers.ok) {
        const list = h('ul', { 'aria-label': 'Followers', class: 'card-list' });
        for (const card of followers.body.followers) list.append(personCardNode(card));
        host.append(h('h2', { class: 'section-title', text: 'Followers' }), list);
      }
    }
  }

  function openPostJobDialog(companyId: string, opener: HTMLElement): void {
    dialog(
      'Post a job',
      (close) => {
        const body = h('div', { class: 'dialog-body' });
        const title = h('input', { type: 'text', 'aria-label': 'Job title', class: 'input' }) as HTMLInputElement;
        const location = h('input', { type: 'text', 'aria-label': 'Location', class: 'input' }) as HTMLInputElement;
        const workplace = h(
          'select',
          { 'aria-label': 'Workplace', class: 'input' },
          [
            h('option', { value: 'on-site' }, ['On-site']),
            h('option', { value: 'hybrid' }, ['Hybrid']),
            h('option', { value: 'remote' }, ['Remote']),
          ],
        ) as HTMLSelectElement;
        const closes = h('input', { type: 'text', 'aria-label': 'Closes', class: 'input' }) as HTMLInputElement;
        const description = h('textarea', {
          'aria-label': 'Description',
          class: 'input',
          rows: '4',
        }) as HTMLTextAreaElement;
        const publish = h(
          'button',
          {
            type: 'button',
            class: 'button',
            click: async () => {
              clearAlerts(body);
              const closesAt = wallTimeToUtc(closes.value, cfg().time_zone);
              if (!closesAt) {
                showAlert(body, S.alert.closesFormat);
                return;
              }
              publish.setAttribute('disabled', '');
              const result = await api.post<{ fields?: Record<string, string> }>('/api/jobs', {
                company_id: companyId,
                title: title.value,
                location: location.value,
                workplace: workplace.value,
                closes_at: closesAt,
                description: description.value,
              });
              publish.removeAttribute('disabled');
              if (result.ok) {
                close();
                void load();
                return;
              }
              const fields = result.body.fields ?? {};
              showAlert(body, Object.values(fields)[0] ?? S.alert.somethingWrong);
            },
          },
          ['Publish job'],
        );
        body.append(title, location, workplace, closes, description);
        return [h('h2', { text: 'Post a job' }), body, publish];
      },
      opener,
    );
  }

  function openEditPageDialog(
    company: { handle: string; name: string; location: string; about: string },
    opener: HTMLElement,
  ): void {
    dialog(
      'Edit page',
      (close) => {
        const body = h('div', { class: 'dialog-body' });
        const name = h('input', {
          type: 'text',
          'aria-label': 'Name',
          class: 'input',
          value: company.name,
        }) as HTMLInputElement;
        const location = h('input', {
          type: 'text',
          'aria-label': 'Location',
          class: 'input',
          value: company.location,
        }) as HTMLInputElement;
        const about = h('textarea', {
          'aria-label': 'About',
          class: 'input',
          rows: '4',
          value: company.about,
        }) as HTMLTextAreaElement;
        const save = h(
          'button',
          {
            type: 'button',
            class: 'button',
            click: async () => {
              const result = await api.patch(
                `/api/companies/${encodeURIComponent(company.handle)}`,
                { name: name.value, location: location.value, about: about.value },
              );
              if (result.ok) {
                close();
                void load();
              } else showAlert(body, S.alert.somethingWrong);
            },
          },
          ['Save'],
        );
        body.append(name, location, about);
        return [h('h2', { text: 'Edit page' }), body, save];
      },
      opener,
    );
  }
}
