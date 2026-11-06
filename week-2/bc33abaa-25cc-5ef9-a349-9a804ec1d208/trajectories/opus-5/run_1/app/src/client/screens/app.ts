import {
  AgentTokenDto,
  AuditEntryDto,
  DashboardDto,
  InvoiceDto,
  InviteDto,
  MemberDto,
  PaymentDto,
  SceneSummaryDto,
  SubscriptionDto,
} from '../../shared/api';
import { formatLocalDate, formatLocalTime, formatMoney, parseZonedTimestamp } from '../../shared/format';
import { PERIOD_NAMES, PLAN_NAMES, PeriodId, PlanId } from '../../shared/plans';
import { ApiCallError, api, idempotencyKey } from '../api';
import {
  announce,
  applyFieldErrors,
  closeDialog,
  el,
  field,
  mount,
  openDialog,
  setFieldError,
} from '../dom';
import { withBusy } from '../motion';
import { navigate } from '../router';
import { Session, renderAppScreen, setFlash, takeFlash } from '../shell';

const TIME_ZONES = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Stockholm',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Australia/Sydney',
  'UTC',
];

function subscriptionCopy(subscription: SubscriptionDto, timeZone: string): string {
  switch (subscription.state) {
    case 'trial':
      return `Trial ends ${subscription.trialEndsAt ? formatLocalTime(subscription.trialEndsAt, timeZone) : ''}`;
    case 'active':
      return `Active: ${PLAN_NAMES[subscription.plan]} ${PERIOD_NAMES[subscription.period]}`;
    case 'past_due':
      return `Past due: grace period ends ${
        subscription.graceEndsAt ? formatLocalTime(subscription.graceEndsAt, timeZone) : ''
      }`;
    case 'suspended':
      return 'Suspended';
    case 'cancelled':
      return 'Cancelled';
  }
}

function figureTile(label: string, value: string): HTMLElement {
  return el('section', { class: 'figure-tile', 'aria-label': label }, [
    el('h2', { text: label }),
    el('p', { class: 'figure', text: value }),
  ]);
}

export function dashboardScreen(root: HTMLElement): void {
  void renderAppScreen(root, 'Dashboard', async (session) => {
    const dashboard = await api.get<DashboardDto>('/api/dashboard');
    return el('div', { class: 'screen dashboard' }, [
      el('h1', { text: 'Dashboard' }),
      el('div', { class: 'tile-grid' }, [
        figureTile('Seats', `${dashboard.seatsUsed} of ${dashboard.seatsPurchased} seats used`),
        figureTile('Subscription', subscriptionCopy(dashboard.subscription, session.timeZone)),
        figureTile('Scenes', `${dashboard.scenes} scenes, ${dashboard.publishedScenes} published`),
        figureTile('Agent tokens', `${dashboard.activeAgentTokens} active agent tokens`),
      ]),
    ]);
  });
}

export function scenesScreen(root: HTMLElement): void {
  void renderAppScreen(root, 'Scenes', async (session) => {
    const data = await api.get<{ scenes: SceneSummaryDto[] }>('/api/scenes');
    const list = el(
      'ul',
      { class: 'scene-list', 'aria-label': 'Scenes' },
      data.scenes.map((scene) =>
        el('li', {}, [
          el('a', { href: `/app/scenes/${scene.id}`, text: scene.name, title: scene.name }),
          el('span', {
            class: 'scene-meta figure',
            text: `${scene.latestSeq} operations${
              scene.publishedVersion === null ? '' : ` · v${scene.publishedVersion} published`
            }`,
          }),
        ]),
      ),
    );
    const results = el('ul', { class: 'scene-list', 'aria-label': 'Search results', hidden: true });
    const search = el('input', { type: 'search', 'aria-label': 'Search scenes', placeholder: 'Search scenes' });
    search.addEventListener('input', () => {
      const term = search.value.trim();
      if (term.length < 2) {
        results.hidden = true;
        list.hidden = false;
        return;
      }
      void api
        .get<{ scenes: { id: string; name: string }[]; assets: { id: string; name: string }[] }>(
          `/api/search?q=${encodeURIComponent(term)}`,
        )
        .then((found) => {
          mount(
            results,
            ...found.scenes.map((scene) =>
              el('li', {}, [el('a', { href: `/app/scenes/${scene.id}`, text: scene.name })]),
            ),
            ...found.assets.map((asset) =>
              el('li', {}, [el('span', { text: `${asset.name} (asset)` })]),
            ),
          );
          results.hidden = false;
          list.hidden = true;
        });
    });

    const newScene = el('button', { type: 'button', class: 'button primary', text: 'New scene' });
    if (!['owner', 'editor'].includes(session.role)) newScene.hidden = true;
    newScene.addEventListener('click', () => {
      const name = el('input', { type: 'text', name: 'name' });
      const create = el('button', { type: 'button', class: 'button primary', text: 'Create scene' });
      const dialog = el('div', { class: 'dialog', 'aria-label': 'New scene' }, [
        el('h2', { text: 'New scene' }),
        field('Scene name', name),
        el('div', { class: 'dialog-actions' }, [create]),
      ]);
      create.addEventListener('click', () => {
        void withBusy(create, async () => {
          try {
            const scene = await api.post<{ id: string }>('/api/scenes', { name: name.value });
            closeDialog(dialog);
            navigate(`/app/scenes/${scene.id}`);
          } catch (error) {
            if (error instanceof ApiCallError && error.errors) applyFieldErrors(dialog, error.errors);
          }
        });
      });
      openDialog(dialog, newScene);
    });

    return el('div', { class: 'screen scenes' }, [
      el('div', { class: 'screen-head' }, [el('h1', { text: 'Scenes' }), newScene]),
      el('div', { class: 'search-row' }, [search]),
      list,
      results,
    ]);
  });
}

export function membersScreen(root: HTMLElement): void {
  void renderAppScreen(root, 'Members', async (session) => {
    const data = await api.get<{ members: MemberDto[]; invites: InviteDto[] }>('/api/members');
    const status = el('p', {
      role: 'status',
      'aria-label': 'Members status',
      class: 'live-status',
      text: takeFlash('Members status'),
    });
    const canInvite = ['owner', 'admin', 'billing_manager'].includes(session.role);
    const canRemove = ['owner', 'admin'].includes(session.role);

    const rows = data.members.map((member) => {
      const cells = [
        el('th', { scope: 'row', text: member.name }),
        el('td', { text: member.email }),
        el('td', { text: member.role }),
        el('td', { class: 'figure', text: formatLocalDate(member.joinedAt, session.timeZone) }),
      ];
      const actions = el('td', {});
      if (canRemove && member.role !== 'owner') {
        const remove = el('button', {
          type: 'button',
          class: 'button danger',
          text: `Remove ${member.name}`,
        });
        remove.addEventListener('click', () => {
          const confirmButton = el('button', { type: 'button', class: 'button danger', text: 'Remove' });
          const cancel = el('button', { type: 'button', class: 'button quiet', text: 'Cancel', 'data-initial-focus': 'true' });
          const dialog = el('div', { class: 'dialog', 'aria-label': 'Remove member' }, [
            el('h2', { text: 'Remove member' }),
            el('p', { text: `${member.name} loses access at once and their seat is freed.` }),
            el('div', { class: 'dialog-actions' }, [cancel, confirmButton]),
          ]);
          cancel.addEventListener('click', () => closeDialog(dialog));
          confirmButton.addEventListener('click', () => {
            void withBusy(confirmButton, async () => {
              try {
                await api.del(`/api/members/${member.id}`);
                closeDialog(dialog);
                setFlash('Members status', `${member.name} was removed. Their seat is free.`);
                membersScreen(root);
              } catch (error) {
                closeDialog(dialog);
                if (error instanceof ApiCallError && error.error === 'owner_cannot_be_removed') {
                  setFlash('Members status', 'The owner cannot be removed.');
                }
              }
            });
          });
          openDialog(dialog, remove, { alert: true });
        });
        actions.append(remove);
      }
      return el('tr', {}, [...cells, actions]);
    });

    const inviteRows = data.invites.map((invite) =>
      el('tr', {}, [
        el('th', { scope: 'row', text: invite.email }),
        el('td', { text: 'Invited' }),
        el('td', { text: invite.role }),
        el('td', { class: 'figure', text: formatLocalTime(invite.expiresAt, session.timeZone) }),
        el('td', {}),
      ]),
    );

    const table = el('table', { class: 'data-table' }, [
      el('caption', { text: 'Members' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Name' }),
          el('th', { scope: 'col', text: 'Email' }),
          el('th', { scope: 'col', text: 'Role' }),
          el('th', { scope: 'col', text: 'Joined' }),
          el('th', { scope: 'col', text: 'Actions' }),
        ]),
      ]),
      el('tbody', {}, [...rows, ...inviteRows]),
    ]);

    const inviteButton = el('button', { type: 'button', class: 'button primary', text: 'Invite member' });
    inviteButton.hidden = !canInvite;
    inviteButton.addEventListener('click', () => {
      const email = el('input', { type: 'email', name: 'email' });
      const roles = ['editor', 'viewer', 'billing_manager', 'admin'].filter(
        (role) => !(role === 'admin' && session.role === 'billing_manager'),
      );
      const role = el(
        'select',
        { name: 'role' },
        roles.map((value) => el('option', { value, text: value })),
      );
      const send = el('button', { type: 'button', class: 'button primary', text: 'Send invite' });
      const dialog = el('div', { class: 'dialog', 'aria-label': 'Invite member' }, [
        el('h2', { text: 'Invite member' }),
        field('Email', email),
        field('Role', role),
        el('div', { class: 'dialog-actions' }, [send]),
      ]);
      send.addEventListener('click', () => {
        void withBusy(send, async () => {
          try {
            await api.post('/api/members/invites', { email: email.value, role: role.value });
            closeDialog(dialog);
            setFlash('Members status', `Invitation created for ${email.value}. The email is on its way.`);
            membersScreen(root);
          } catch (error) {
            if (!(error instanceof ApiCallError)) return;
            if (error.error === 'no_seats_left') {
              setFlash('Members status', 'No seats left. Add seats in Billing or remove a member.');
              closeDialog(dialog);
              return;
            }
            if (error.error === 'already_member') {
              setFieldError(email, `${email.value} is already a member or invited.`);
              announce(status, `${email.value} is already a member or invited.`);
              return;
            }
            if (error.errors) applyFieldErrors(dialog, error.errors);
          }
        });
      });
      openDialog(dialog, inviteButton);
    });

    return el('div', { class: 'screen members' }, [
      el('div', { class: 'screen-head' }, [el('h1', { text: 'Members' }), inviteButton]),
      status,
      el('div', { class: 'table-scroll' }, [table]),
    ]);
  });
}

function expiresField(session: Session, label: string): { input: HTMLInputElement; wrap: HTMLElement } {
  const input = el('input', {
    type: 'text',
    name: 'expiresAt',
    placeholder: 'YYYY-MM-DD HH:mm:ss',
  });
  const wrap = field(label, input, { hint: `Time zone: ${session.timeZone}` });
  return { input, wrap };
}

export function agentsScreen(root: HTMLElement): void {
  void renderAppScreen(root, 'Agents', async (session) => {
    const data = await api.get<{ tokens: AgentTokenDto[] }>('/api/agent-tokens');
    const status = el('p', {
      role: 'status',
      'aria-label': 'Members status',
      class: 'live-status',
      text: takeFlash('Members status'),
    });
    const secretRegion = el('section', { 'aria-label': 'New token', class: 'new-token' });
    secretRegion.hidden = true;

    const rows = data.tokens.map((token) => {
      const actions = el('td', {});
      if (token.status === 'active') {
        const revoke = el('button', {
          type: 'button',
          class: 'button danger',
          text: `Revoke ${token.name}`,
        });
        revoke.addEventListener('click', () => {
          void withBusy(revoke, async () => {
            try {
              await api.del(`/api/agent-tokens/${token.id}`);
              setFlash('Members status', `Token ${token.name} revoked.`);
              agentsScreen(root);
            } catch {
              announce(status, `Token ${token.name} could not be revoked.`);
            }
          });
        });
        actions.append(revoke);
      }
      return el('tr', {}, [
        el('th', { scope: 'row', text: token.name }),
        el('td', { text: token.scope }),
        el('td', { class: 'figure', text: formatLocalTime(token.expiresAt, session.timeZone) }),
        el('td', { text: token.status }),
        el('td', { text: token.issuedBy.name }),
        actions,
      ]);
    });

    const table = el('table', { class: 'data-table' }, [
      el('caption', { text: 'Agent tokens' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Name' }),
          el('th', { scope: 'col', text: 'Scope' }),
          el('th', { scope: 'col', text: 'Expires' }),
          el('th', { scope: 'col', text: 'Status' }),
          el('th', { scope: 'col', text: 'Issued by' }),
          el('th', { scope: 'col', text: 'Actions' }),
        ]),
      ]),
      el('tbody', {}, rows),
    ]);

    const issueButton = el('button', { type: 'button', class: 'button primary', text: 'Issue token' });
    issueButton.addEventListener('click', () => {
      const name = el('input', { type: 'text', name: 'name' });
      const scopeRead = el('input', { type: 'radio', name: 'scope', value: 'read', id: 'scope-read' });
      const scopeEdit = el('input', {
        type: 'radio',
        name: 'scope',
        value: 'edit',
        id: 'scope-edit',
        checked: true,
      });
      const expires = expiresField(session, 'Expires');
      const issue = el('button', { type: 'button', class: 'button primary', text: 'Issue token' });
      const dialog = el('div', { class: 'dialog', 'aria-label': 'Issue agent token' }, [
        el('h2', { text: 'Issue agent token' }),
        field('Token name', name),
        el('div', { role: 'radiogroup', 'aria-label': 'Scope', class: 'segmented' }, [
          el('label', { class: 'radio-pill' }, [scopeRead, el('span', { text: 'Read' })]),
          el('label', { class: 'radio-pill' }, [scopeEdit, el('span', { text: 'Edit' })]),
        ]),
        expires.wrap,
        el('div', { class: 'dialog-actions' }, [issue]),
      ]);
      issue.addEventListener('click', () => {
        const instant = parseZonedTimestamp(expires.input.value, session.timeZone);
        if (!instant) {
          setFieldError(expires.input, 'Use YYYY-MM-DD HH:mm:ss.');
          return;
        }
        setFieldError(expires.input, null);
        void withBusy(issue, async () => {
          try {
            const token = await api.post<AgentTokenDto & { token: string }>('/api/agent-tokens', {
              name: name.value,
              scope: scopeRead.checked ? 'read' : 'edit',
              expiresAt: instant,
            });
            closeDialog(dialog);
            secretRegion.hidden = false;
            mount(
              secretRegion,
              el('h2', { text: 'New token' }),
              el('p', { class: 'token-secret figure', text: token.token }),
              el('p', { text: 'Copy this token now. It will not be shown again.' }),
            );
            announce(status, `Token ${token.name} issued.`);
            const fresh = await api.get<{ tokens: AgentTokenDto[] }>('/api/agent-tokens');
            mount(
              table.querySelector('tbody') ?? el('tbody'),
              ...fresh.tokens.map((entry) =>
                el('tr', {}, [
                  el('th', { scope: 'row', text: entry.name }),
                  el('td', { text: entry.scope }),
                  el('td', {
                    class: 'figure',
                    text: formatLocalTime(entry.expiresAt, session.timeZone),
                  }),
                  el('td', { text: entry.status }),
                  el('td', { text: entry.issuedBy.name }),
                  el('td', {}),
                ]),
              ),
            );
          } catch (error) {
            if (error instanceof ApiCallError) {
              if (error.error === 'token_limit_reached') {
                setFieldError(name, 'This plan allows no more active tokens.');
                return;
              }
              if (error.errors) applyFieldErrors(dialog, error.errors);
            }
          }
        });
      });
      openDialog(dialog, issueButton);
    });

    return el('div', { class: 'screen agents' }, [
      el('div', { class: 'screen-head' }, [el('h1', { text: 'Agents' }), issueButton]),
      status,
      secretRegion,
      el('div', { class: 'table-scroll' }, [table]),
    ]);
  });
}

export function auditScreen(root: HTMLElement): void {
  void renderAppScreen(root, 'Audit', async (session) => {
    const data = await api.get<{ entries: AuditEntryDto[] }>('/api/audit?limit=200');
    const table = el('table', { class: 'data-table' }, [
      el('caption', { text: 'Audit trail' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Time' }),
          el('th', { scope: 'col', text: 'Actor' }),
          el('th', { scope: 'col', text: 'Action' }),
          el('th', { scope: 'col', text: 'Target' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        data.entries.map((entry) =>
          el('tr', {}, [
            el('th', { scope: 'row', class: 'figure', text: formatLocalTime(entry.at, session.timeZone) }),
            el('td', { text: entry.actor.name }),
            el('td', { text: entry.action }),
            el('td', { class: 'figure', text: `${entry.target.type} ${entry.target.id}` }),
          ]),
        ),
      ),
    ]);
    return el('div', { class: 'screen audit' }, [
      el('h1', { text: 'Audit' }),
      el('div', { class: 'table-scroll' }, [table]),
    ]);
  });
}

export function settingsScreen(root: HTMLElement): void {
  void renderAppScreen(root, 'Settings', async (session) => {
    const workspace = await api.get<{ timeZone: string; reviewLinksEnabled: boolean }>('/api/workspace');
    const zone = el(
      'select',
      { name: 'timeZone' },
      [...new Set([workspace.timeZone, ...TIME_ZONES])].map((value) =>
        el('option', { value, text: value, selected: value === workspace.timeZone }),
      ),
    );
    const toggle = el('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': workspace.reviewLinksEnabled ? 'true' : 'false',
      class: 'switch',
      text: 'Allow review links',
      'aria-label': 'Allow review links',
    });
    toggle.addEventListener('click', () => {
      toggle.setAttribute(
        'aria-checked',
        toggle.getAttribute('aria-checked') === 'true' ? 'false' : 'true',
      );
    });
    const status = el('p', { role: 'status', class: 'live-status' });
    const save = el('button', { type: 'button', class: 'button primary', text: 'Save settings' });
    save.addEventListener('click', () => {
      void withBusy(save, async () => {
        await api.patch('/api/workspace', {
          timeZone: zone.value,
          reviewLinksEnabled: toggle.getAttribute('aria-checked') === 'true',
        });
        announce(status, 'Settings saved.');
      });
    });
    return el('div', { class: 'screen settings' }, [
      el('h1', { text: 'Settings' }),
      el('div', { class: 'panel' }, [
        field('Workspace time zone', zone),
        el('div', { class: 'field' }, [toggle]),
        save,
        status,
      ]),
      el('p', { class: 'muted', text: `Current time zone: ${session.timeZone}` }),
    ]);
  });
}

interface BillingData {
  subscription: SubscriptionDto;
  card: { last4: string } | null;
}

export function billingScreen(root: HTMLElement): void {
  void renderAppScreen(root, 'Billing', async (session) => {
    const billing = await api.get<BillingData>('/api/billing');
    let invoices: InvoiceDto[] = [];
    let payments: PaymentDto[] = [];
    let billingOutage = false;
    try {
      const data = await api.get<{ invoices: InvoiceDto[]; payments: PaymentDto[] }>(
        '/api/billing/invoices',
      );
      invoices = data.invoices;
      payments = data.payments;
    } catch (error) {
      if (error instanceof ApiCallError && error.service === 'billing') billingOutage = true;
    }

    const status = el('p', {
      role: 'status',
      'aria-label': 'Billing status',
      class: 'live-status',
      text: takeFlash('Billing status'),
    });
    if (billingOutage) {
      status.textContent =
        'Billing is unavailable right now. Nothing was charged. Editing and publishing keep working.';
    }

    const planTeam = el('input', {
      type: 'radio',
      name: 'plan',
      value: 'team',
      id: 'plan-team',
      checked: billing.subscription.plan === 'team',
    });
    const planBusiness = el('input', {
      type: 'radio',
      name: 'plan',
      value: 'business',
      id: 'plan-business',
      checked: billing.subscription.plan === 'business',
    });
    const periodMonthly = el('input', {
      type: 'radio',
      name: 'billing-period',
      value: 'monthly',
      id: 'bill-monthly',
      checked: billing.subscription.period === 'monthly',
    });
    const periodAnnual = el('input', {
      type: 'radio',
      name: 'billing-period',
      value: 'annual',
      id: 'bill-annual',
      checked: billing.subscription.period === 'annual',
    });
    const extraSeats = el('input', {
      type: 'number',
      name: 'extraSeats',
      min: '0',
      max: '500',
      step: '1',
      value: String(billing.subscription.extraSeats),
    });
    const cardNumber = el('input', { type: 'text', name: 'cardNumber', inputmode: 'numeric', autocomplete: 'off' });
    const cardExpiry = el('input', { type: 'text', name: 'cardExpiry', placeholder: 'MM/YY' });
    const cardCvc = el('input', { type: 'text', name: 'cardCvc', inputmode: 'numeric', autocomplete: 'off' });

    const chosenPlan = (): PlanId => (planBusiness.checked ? 'business' : 'team');
    const chosenPeriod = (): PeriodId => (periodAnnual.checked ? 'annual' : 'monthly');

    function readCard(): { number: string; expMonth: number; expYear: number; cvc: string } | null {
      const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(cardExpiry.value.trim());
      if (!match) {
        setFieldError(cardExpiry, 'Use MM/YY.');
        return null;
      }
      setFieldError(cardExpiry, null);
      return {
        number: cardNumber.value.replace(/\s+/g, ''),
        expMonth: Number(match[1]),
        expYear: 2000 + Number(match[2]),
        cvc: cardCvc.value.trim(),
      };
    }

    function reportBillingError(error: unknown, form: HTMLElement): void {
      if (!(error instanceof ApiCallError)) {
        announce(status, 'Something went wrong. Try again.');
        return;
      }
      if (error.service === 'billing') {
        announce(
          status,
          'Billing is unavailable right now. Nothing was charged. Editing and publishing keep working.',
        );
        return;
      }
      if (error.error === 'card_declined') {
        announce(status, 'Your card was declined. Nothing was charged.');
        return;
      }
      if (error.error === 'seats_in_use') {
        const seatsUsed = error.body.seatsUsed as number;
        const seats = error.body.seatsAfter as number;
        announce(
          status,
          `You have ${seatsUsed} people and invitations, more than the ${seats} seats this choice includes.`,
        );
        return;
      }
      if (error.error === 'invoice_already_paid') {
        announce(status, 'This invoice is already paid.');
        return;
      }
      if (error.errors) {
        const message = applyFieldErrors(form, error.errors);
        announce(status, message ?? Object.values(error.errors)[0] ?? '');
        return;
      }
      if (error.error === 'subscription_not_active') {
        announce(status, 'The subscription is not active.');
        return;
      }
      announce(status, 'Something went wrong. Try again.');
    }

    const planRegion = el('section', { 'aria-label': 'Plan', class: 'panel' });
    const prorationRegion = el('section', {
      'aria-label': 'Proration preview',
      class: 'panel proration',
    });

    const startPaid = el('button', { type: 'button', class: 'button primary', text: 'Start paid plan' });
    const previewChange = el('button', { type: 'button', class: 'button', text: 'Preview change' });
    const changePlan = el('button', { type: 'button', class: 'button primary', text: 'Change plan' });
    const updateSeats = el('button', { type: 'button', class: 'button', text: 'Update seats' });
    const cancelSubscription = el('button', {
      type: 'button',
      class: 'button danger',
      text: 'Cancel subscription',
    });

    const trialLike = billing.subscription.state === 'trial' ||
      (billing.subscription.state === 'suspended' && billing.subscription.trialEndsAt !== null);
    startPaid.hidden = !trialLike;
    changePlan.hidden = trialLike;
    previewChange.hidden = trialLike;
    updateSeats.hidden = trialLike;
    cancelSubscription.hidden =
      session.role !== 'owner' || billing.subscription.state === 'cancelled';

    startPaid.addEventListener('click', () => {
      const card = readCard();
      if (!card) return;
      void withBusy(startPaid, async () => {
        announce(status, 'Processing payment…');
        try {
          const result = await api.post<{ invoice: InvoiceDto }>(
            '/api/billing/checkout',
            {
              plan: chosenPlan(),
              period: chosenPeriod(),
              extraSeats: Number(extraSeats.value),
              card,
            },
            idempotencyKey('checkout'),
          );
          setFlash(
            'Billing status',
            `Payment recorded for invoice ${result.invoice.number}. A receipt is on its way.`,
          );
          billingScreen(root);
        } catch (error) {
          reportBillingError(error, planRegion);
        }
      });
    });

    previewChange.addEventListener('click', () => {
      void withBusy(previewChange, async () => {
        prorationRegion.textContent = 'Calculating…';
        try {
          const preview = await api.get<{
            change: 'immediate' | 'end_of_term';
            amountCents: number;
            effectiveAt: string | null;
          }>(
            `/api/billing/plan/preview?plan=${chosenPlan()}&period=${chosenPeriod()}`,
          );
          mount(
            prorationRegion,
            el('h2', { text: 'Proration preview' }),
            el('p', {
              class: 'figure',
              text:
                preview.change === 'immediate'
                  ? `Due today: ${formatMoney(preview.amountCents)}`
                  : `No charge today. Your plan changes on ${
                      preview.effectiveAt ? formatLocalDate(preview.effectiveAt, session.timeZone) : ''
                    }.`,
            }),
          );
        } catch (error) {
          prorationRegion.textContent = '';
          reportBillingError(error, planRegion);
        }
      });
    });

    changePlan.addEventListener('click', () => {
      void withBusy(changePlan, async () => {
        try {
          const result = await api.post<{
            change: 'immediate' | 'end_of_term';
            invoice?: InvoiceDto | null;
            effectiveAt?: string;
          }>(
            '/api/billing/plan',
            { plan: chosenPlan(), period: chosenPeriod() },
            idempotencyKey('plan'),
          );
          if (result.change === 'immediate') {
            setFlash('Billing status', `Plan changed to ${PLAN_NAMES[chosenPlan()]} ${PERIOD_NAMES[chosenPeriod()]}. Charged ${formatMoney(
                result.invoice?.amountCents ?? 0,
              )}.`,
            );
          } else {
            setFlash(
              'Billing status',
              `Your plan changes to ${PLAN_NAMES[chosenPlan()]} ${PERIOD_NAMES[chosenPeriod()]} on ${
                result.effectiveAt ? formatLocalDate(result.effectiveAt, session.timeZone) : ''
              }.`,
            );
          }
          billingScreen(root);
        } catch (error) {
          if (error instanceof ApiCallError && error.errors?.plan === 'Already on this plan') {
            announce(status, 'You are already on this plan.');
            return;
          }
          reportBillingError(error, planRegion);
        }
      });
    });

    updateSeats.addEventListener('click', () => {
      void withBusy(updateSeats, async () => {
        try {
          const result = await api.post<{
            change: 'immediate' | 'end_of_term';
            subscription: SubscriptionDto;
            invoice?: InvoiceDto | null;
            effectiveAt?: string;
          }>(
            '/api/billing/seats',
            { extraSeats: Number(extraSeats.value) },
            idempotencyKey('seats'),
          );
          if (result.change === 'immediate') {
            announce(
              status,
              `Seats updated to ${result.subscription.seatsPurchased}. Charged ${formatMoney(
                result.invoice?.amountCents ?? 0,
              )}.`,
            );
          } else {
            setFlash(
              'Billing status',
              `Seats drop to ${
                result.subscription.pendingChange
                  ? result.subscription.pendingChange.extraSeats +
                    (result.subscription.seatsPurchased - result.subscription.extraSeats)
                  : result.subscription.seatsPurchased
              } on ${
                result.effectiveAt ? formatLocalDate(result.effectiveAt, session.timeZone) : ''
              }.`,
            );
          }
          billingScreen(root);
        } catch (error) {
          reportBillingError(error, planRegion);
        }
      });
    });

    cancelSubscription.addEventListener('click', () => {
      const confirmButton = el('button', {
        type: 'button',
        class: 'button danger',
        text: 'Cancel subscription',
      });
      const keep = el('button', {
        type: 'button',
        class: 'button quiet',
        text: 'Keep subscription',
        'data-initial-focus': 'true',
      });
      const dialog = el('div', { class: 'dialog', 'aria-label': 'Cancel subscription' }, [
        el('h2', { text: 'Cancel subscription' }),
        el('p', { text: 'Cancellation is final. The workspace becomes read-only for scene work.' }),
        el('div', { class: 'dialog-actions' }, [keep, confirmButton]),
      ]);
      keep.addEventListener('click', () => closeDialog(dialog));
      confirmButton.addEventListener('click', () => {
        void withBusy(confirmButton, async () => {
          try {
            await api.post('/api/billing/cancel', {}, idempotencyKey('cancel'));
            closeDialog(dialog);
            setFlash('Billing status', 'Subscription cancelled. The workspace is now read-only.');
            billingScreen(root);
          } catch (error) {
            closeDialog(dialog);
            reportBillingError(error, planRegion);
          }
        });
      });
      openDialog(dialog, cancelSubscription, { alert: true });
    });

    mount(
      planRegion,
      el('h2', { text: 'Plan' }),
      el('p', { class: 'figure', text: subscriptionCopy(billing.subscription, session.timeZone) }),
      el('p', {
        class: 'figure',
        text: `${billing.subscription.seatsPurchased} seats purchased · ${billing.subscription.extraSeats} extra`,
      }),
      billing.card ? el('p', { class: 'figure', text: `Card ending ${billing.card.last4}` }) : null,
      billing.subscription.pendingChange
        ? el('p', {
            text: `Pending change: ${PLAN_NAMES[billing.subscription.pendingChange.plan]} ${
              PERIOD_NAMES[billing.subscription.pendingChange.period]
            } with ${billing.subscription.pendingChange.extraSeats} extra seats on ${formatLocalDate(
              billing.subscription.pendingChange.effectiveAt,
              session.timeZone,
            )}`,
          })
        : null,
      el('div', { role: 'radiogroup', 'aria-label': 'Plan', class: 'segmented' }, [
        el('label', { class: 'radio-pill' }, [planTeam, el('span', { text: 'Team' })]),
        el('label', { class: 'radio-pill' }, [planBusiness, el('span', { text: 'Business' })]),
      ]),
      el('div', { role: 'radiogroup', 'aria-label': 'Billing period', class: 'segmented' }, [
        el('label', { class: 'radio-pill' }, [periodMonthly, el('span', { text: 'Monthly' })]),
        el('label', { class: 'radio-pill' }, [periodAnnual, el('span', { text: 'Annual' })]),
      ]),
      field('Extra seats', extraSeats),
      field('Card number', cardNumber),
      field('Expiry (MM/YY)', cardExpiry),
      field('CVC', cardCvc),
      el('div', { class: 'button-row' }, [
        startPaid,
        previewChange,
        changePlan,
        updateSeats,
        cancelSubscription,
      ]),
    );

    const invoiceRows = invoices.map((invoice) => {
      const actions = el('td', {});
      if (invoice.status === 'unpaid') {
        const pay = el('button', {
          type: 'button',
          class: 'button primary',
          text: `Pay invoice ${invoice.number}`,
        });
        pay.addEventListener('click', () => {
          const card = readCard();
          if (!card) return;
          void withBusy(pay, async () => {
            announce(status, 'Processing payment…');
            try {
              await api.post(
                `/api/billing/invoices/${invoice.id}/pay`,
                { card },
                idempotencyKey('pay'),
              );
              setFlash(
                'Billing status',
                `Payment recorded for invoice ${invoice.number}. A receipt is on its way.`,
              );
              billingScreen(root);
            } catch (error) {
              reportBillingError(error, planRegion);
            }
          });
        });
        actions.append(pay);
      }
      if (invoice.pdfAvailable) {
        actions.append(
          el('a', {
            href: `/api/billing/invoices/${invoice.id}/pdf`,
            text: `Download invoice ${invoice.number}`,
            download: `invoice-${invoice.number}.pdf`,
          }),
        );
      }
      if (invoice.status === 'paid') {
        const payment = payments.find((candidate) => candidate.invoiceId === invoice.id);
        if (payment) {
          const refund = el('button', {
            type: 'button',
            class: 'button',
            text: `Refund invoice ${invoice.number}`,
          });
          refund.addEventListener('click', () => {
            void withBusy(refund, async () => {
              try {
                const result = await api.post<{ payment: PaymentDto }>(
                  `/api/billing/payments/${payment.id}/refund`,
                  {},
                  idempotencyKey('refund'),
                );
                setFlash('Billing status', `Refunded ${formatMoney(
                    result.payment.refundedCents - payment.refundedCents,
                  )} for invoice ${invoice.number}.`);
                billingScreen(root);
              } catch (error) {
                if (
                  error instanceof ApiCallError &&
                  error.errors?.amountCents === 'More than the refundable balance'
                ) {
                  announce(status, 'That is more than the refundable balance.');
                  return;
                }
                reportBillingError(error, planRegion);
              }
            });
          });
          actions.append(refund);
        }
      }
      return el('tr', {}, [
        el('th', { scope: 'row', class: 'figure', text: invoice.number }),
        el('td', { class: 'figure', text: invoice.date }),
        el('td', { class: 'figure', text: formatMoney(invoice.amountCents) }),
        el('td', { class: 'figure', text: formatMoney(invoice.balanceCents) }),
        el('td', { text: invoice.status === 'paid' ? 'Paid' : 'Unpaid' }),
        actions,
      ]);
    });

    const invoiceTable = el('table', { class: 'data-table' }, [
      el('caption', { text: 'Invoices' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Invoice' }),
          el('th', { scope: 'col', text: 'Date' }),
          el('th', { scope: 'col', text: 'Amount' }),
          el('th', { scope: 'col', text: 'Balance' }),
          el('th', { scope: 'col', text: 'Status' }),
          el('th', { scope: 'col', text: 'Actions' }),
        ]),
      ]),
      el('tbody', {}, invoiceRows),
    ]);

    return el('div', { class: 'screen billing' }, [
      el('h1', { text: 'Billing' }),
      status,
      el('div', { class: 'billing-grid' }, [
        planRegion,
        el('div', { class: 'billing-column' }, [
          prorationRegion,
          el('div', { class: 'table-scroll' }, [invoiceTable]),
        ]),
      ]),
    ]);
  });
}
