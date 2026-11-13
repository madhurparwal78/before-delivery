import { useEffect, useRef, useState } from 'react';
import { api } from '../app/api';
import { Link, useAnnounce, useLive, useRemembered, useRouter } from '../app/shell';
import { Overlay } from '../components/overlays';
import { BottomBar, Card, DialogMessage, Field } from '../components/pieces';
import { BlendSummary, PlanText } from './member';
import {
  BlendView,
  MemberView,
  PlanView,
  copy,
  displayDateOfInstant,
  PRACTICE_ZONE,
} from '../app/types';

interface Sections {
  nutrition: string;
  movement: string;
  sleep: string;
  supplements: string;
}

export function StaffPlanScreen({ memberId }: { memberId: string }): JSX.Element {
  const { announce } = useAnnounce();
  const { navigate } = useRouter();
  const [open, setOpen] = useRemembered(`plan-open:${memberId}`, false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [sections, setSections] = useRemembered<Sections>(`plan-sections:${memberId}`, {
    nutrition: '',
    movement: '',
    sleep: '',
    supplements: '',
  });
  const [dialogMessage, setDialogMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  const editButton = useRef<HTMLButtonElement | null>(null);

  const { data: member } = useLive<MemberView>(async () => {
    const result = await api<{ member: MemberView }>(`/api/members/${memberId}`);
    return result.data?.member ?? null;
  }, [memberId]);
  const { data: plans, reload } = useLive<PlanView[]>(async () => {
    const result = await api<{ plans: PlanView[] }>(`/api/members/${memberId}/plans`);
    return result.data?.plans ?? null;
  }, [memberId]);
  const { data: blend } = useLive<BlendView | null>(async () => {
    const result = await api<{ blends: BlendView[] }>(`/api/members/${memberId}/blends`);
    return result.data ? (result.data.blends[0] ?? null) : null;
  }, [memberId]);

  const published = (plans ?? []).filter((plan) => plan.state === 'published');
  const latest = published[0] ?? null;
  const draft = (plans ?? []).find((plan) => plan.state === 'draft') ?? null;

  useEffect(() => {
    if (!open || loaded.current) return;
    const source = draft ?? latest;
    const empty = Object.values(sections).every((text) => text === '');
    if (source && empty) setSections(source.sections);
    if (source || !empty) loaded.current = true;
    setDraftId(draft?.id ?? null);
  }, [open, draft, latest, sections, setSections]);

  const openDialog = (): void => {
    loaded.current = false;
    setOpen(true);
  };

  const saveDraft = async (publish: boolean): Promise<void> => {
    setBusy(true);
    setDialogMessage(null);
    announce(copy.working);
    let planId = draftId;
    if (planId === null) {
      const created = await api<{ plan: PlanView }>(`/api/members/${memberId}/plans`, {
        method: 'POST',
        json: { basedOnPlanId: latest?.id ?? null, sections },
      });
      if (created.error) {
        setBusy(false);
        setDialogMessage(created.error.message);
        announce(created.error.message);
        return;
      }
      planId = created.data?.plan.id ?? null;
      setDraftId(planId);
    } else {
      const saved = await api(`/api/longevity-plans/${planId}`, { method: 'PUT', json: { sections } });
      if (saved.error) {
        setBusy(false);
        setDialogMessage(saved.error.message);
        announce(saved.error.message);
        return;
      }
    }
    if (!publish) {
      setBusy(false);
      announce(copy.draftSaved);
      reload();
      return;
    }
    const result = await api<{ plan: PlanView }>(`/api/longevity-plans/${planId}/publish`, {
      method: 'POST',
      json: {},
    });
    setBusy(false);
    if (result.error) {
      setDialogMessage(result.error.message);
      announce(result.error.message);
      return;
    }
    announce(copy.planPublished);
    setDraftId(null);
    setOpen(false);
    reload();
    const planIdPublished = result.data?.plan.id;
    if (planIdPublished) navigate(`/staff/members/${memberId}/plans/${planIdPublished}`);
  };

  return (
    <>
      <h1 tabIndex={-1}>Plan for {member?.name ?? ''}</h1>
      <Card>
        {latest ? (
          <>
            <p>
              {copy.planByline(
                displayDateOfInstant(latest.publishedAt ?? latest.updatedAt, PRACTICE_ZONE),
                latest.publishedBy ?? '',
              )}
            </p>
            <h2>Nutrition</h2>
            <PlanText text={latest.sections.nutrition} />
            <h2>Movement</h2>
            <PlanText text={latest.sections.movement} />
            <h2>Sleep</h2>
            <PlanText text={latest.sections.sleep} />
            <h2>Supplements</h2>
            <PlanText text={latest.sections.supplements} />
            <BlendSummary blend={blend ?? null} />
          </>
        ) : (
          <p className="muted">No published plan yet.</p>
        )}
      </Card>
      <Card>
        <h2>Earlier plans</h2>
        <ul className="log" aria-label="Earlier plans">
          {published.slice(1).map((plan) => (
            <li key={plan.id}>
              <Link to={`/staff/members/${memberId}/plans/${plan.id}`}>
                {copy.planByline(
                  displayDateOfInstant(plan.publishedAt ?? plan.updatedAt, PRACTICE_ZONE),
                  plan.publishedBy ?? '',
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Overlay name="Edit plan" open={open} onClose={() => setOpen(false)} opener={editButton}>
        <h2>Edit plan</h2>
        <DialogMessage text={dialogMessage} />
        <Field label="Nutrition" name="nutrition">
          <textarea
            id="field-nutrition"
            aria-label="Nutrition"
            value={sections.nutrition}
            onChange={(event) => setSections({ ...sections, nutrition: event.target.value })}
          />
        </Field>
        <Field label="Movement" name="movement">
          <textarea
            id="field-movement"
            aria-label="Movement"
            value={sections.movement}
            onChange={(event) => setSections({ ...sections, movement: event.target.value })}
          />
        </Field>
        <Field label="Sleep" name="sleep">
          <textarea
            id="field-sleep"
            aria-label="Sleep"
            value={sections.sleep}
            onChange={(event) => setSections({ ...sections, sleep: event.target.value })}
          />
        </Field>
        <Field label="Supplements notes" name="supplements">
          <textarea
            id="field-supplements"
            aria-label="Supplements notes"
            value={sections.supplements}
            onChange={(event) => setSections({ ...sections, supplements: event.target.value })}
          />
        </Field>
        <div className="radio-row">
          <button type="button" className="quiet" disabled={busy} onClick={() => void saveDraft(false)}>
            Save draft
          </button>
          <button type="button" disabled={busy} onClick={() => void saveDraft(true)}>
            Publish plan
          </button>
        </div>
      </Overlay>
      <BottomBar>
        <button type="button" ref={editButton} onClick={openDialog}>
          Edit plan
        </button>
      </BottomBar>
    </>
  );
}

export function StaffPlanVersionScreen({
  memberId,
  planId,
}: {
  memberId: string;
  planId: string;
}): JSX.Element {
  const { data: plan } = useLive<PlanView>(async () => {
    const result = await api<{ plan: PlanView }>(`/api/longevity-plans/${planId}`);
    return result.data?.plan ?? null;
  }, [planId]);
  const { data: plans } = useLive<PlanView[]>(async () => {
    const result = await api<{ plans: PlanView[] }>(`/api/members/${memberId}/plans`);
    return result.data?.plans ?? null;
  }, [memberId]);
  const { data: currentBlend } = useLive<BlendView | null>(async () => {
    const result = await api<{ blends: BlendView[] }>(`/api/members/${memberId}/blends`);
    return result.data ? (result.data.blends[0] ?? null) : null;
  }, [memberId]);

  const latestPublished = (plans ?? []).find((entry) => entry.state === 'published') ?? null;
  const isLatest = latestPublished !== null && plan !== null && latestPublished.id === plan.id;
  const blend = isLatest ? currentBlend ?? plan?.blend ?? null : plan?.blend ?? null;

  return (
    <>
      <h1 tabIndex={-1}>
        Plan published{' '}
        {plan ? displayDateOfInstant(plan.publishedAt ?? plan.updatedAt, PRACTICE_ZONE) : ''}
      </h1>
      <Card>
        {plan ? (
          <>
            <p>
              {copy.planByline(
                displayDateOfInstant(plan.publishedAt ?? plan.updatedAt, PRACTICE_ZONE),
                plan.publishedBy ?? '',
              )}
            </p>
            <h2>Nutrition</h2>
            <PlanText text={plan.sections.nutrition} />
            <h2>Movement</h2>
            <PlanText text={plan.sections.movement} />
            <h2>Sleep</h2>
            <PlanText text={plan.sections.sleep} />
            <h2>Supplements</h2>
            <PlanText text={plan.sections.supplements} />
            <BlendSummary blend={blend} />
          </>
        ) : null}
      </Card>
      <BottomBar>
        <Link to={`/staff/members/${memberId}/plan`} className="button">
          Back to plan
        </Link>
      </BottomBar>
    </>
  );
}
