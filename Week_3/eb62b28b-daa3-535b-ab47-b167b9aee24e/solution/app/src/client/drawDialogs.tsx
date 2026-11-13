// The Book draw and Move draw dialogs. Slots always come from the server, in the member's wall time.

import { DrawAnswer, MembersAnswer, PhlebotomistsAnswer, SlotsAnswer, type DrawView, type MemberAnyView, type Phlebotomist, type Slot } from "../shared/api";
import { formatDate, twoTimeLine } from "../shared/format";
import { addDays, cityOf, instantOf, isIsoDate, localDate, wholeSeconds, type TimeZone } from "../shared/time";
import { getJson, sendJson, serverNow } from "./api";
import { closeDialog, navigate } from "./stores";
import { Button, Dialog, DialogMessage, onSubmit, RadioGroup, SelectField, TextField, useAction, useForm, useLoad, type Action, type Form } from "./ui";

function memberTime(draw: DrawView): string {
  return `${formatDate(draw.localDate)}, ${draw.localTime} ${cityOf(draw.timeZone)} time`;
}

const staffTime = (draw: DrawView): string => twoTimeLine(draw.localDate, draw.startsAt, draw.timeZone);

function SlotChoices({ form, action, slots, zone, phlebotomistId }: { form: Form; action: Action; slots: readonly Slot[]; zone: TimeZone | null; phlebotomistId: string }) {
  const open = slots.filter((slot) => slot.phlebotomistId === phlebotomistId && slot.free);
  if (!zone || !phlebotomistId || !isIsoDate(form.value("date"))) return <p className="field-hint">Choose the date to see its free times.</p>;
  if (open.length === 0) return <p className="field-hint">No free slots on this date.</p>;
  const city = cityOf(zone);
  return (
    <RadioGroup
      form={form}
      name="time"
      label="Time"
      problem={action.problem}
      choices={open.map((slot) => ({ value: slot.localTime, label: `${slot.localTime} ${city} time` }))}
    />
  );
}

function PastDrawFields({ form, action }: { form: Form; action: Action }) {
  return (
    <>
      <TextField form={form} name="collectedTime" label="Collected time" problem={action.problem} hint="The member-local time, as HH:MM" />
      <TextField form={form} name="kitCode" label="Kit code" problem={action.problem} />
    </>
  );
}

function pastDrawFields(form: Form, zone: TimeZone, date: string): Record<string, unknown> {
  if (date >= localDate(serverNow(), zone)) return {};
  const time = form.value("collectedTime");
  const code = form.value("kitCode");
  return {
    ...(/^\d{2}:\d{2}$/.test(time) ? { collectedAt: wholeSeconds(instantOf(date, time, zone)) } : {}),
    ...(code ? { kitCodes: [code] } : {}),
  };
}

export function StaffBookDraw({ member, chooseMember }: { member: MemberAnyView | null; chooseMember: boolean }) {
  const dialog = "book-draw";
  return (
    <Dialog id={dialog} title="Book draw">
      <StaffBookDrawBody member={member} chooseMember={chooseMember} />
    </Dialog>
  );
}

function StaffBookDrawBody({ member, chooseMember }: { member: MemberAnyView | null; chooseMember: boolean }) {
  const form = useForm("book-draw", { memberId: member?.id ?? "", phlebotomistId: "", date: "", time: "", collectedTime: "", kitCode: "" });
  const action = useAction();
  const members = useLoad(() => getJson("/api/members", MembersAnswer), `book-members-${chooseMember}`, false);
  const phlebotomists = useLoad(() => getJson("/api/phlebotomists", PhlebotomistsAnswer), "book-phlebotomists", false);
  const chosenMember = member ?? members.data?.members.find((entry) => entry.id === form.value("memberId")) ?? null;
  const date = form.value("date");
  const slots = useLoad(
    async () => (chosenMember && isIsoDate(date) ? getJson(`/api/slots?memberId=${chosenMember.id}&date=${date}`, SlotsAnswer) : { slots: [] }),
    `slots-${chosenMember?.id ?? ""}-${date}`,
  );
  const serving = (phlebotomists.data?.phlebotomists ?? []).filter((entry: Phlebotomist) => chosenMember?.state != null && entry.states.includes(chosenMember.state));
  const zone = chosenMember?.timeZone ?? null;
  const isPast = zone !== null && isIsoDate(date) && date < localDate(serverNow(), zone);

  const submit = (): void => {
    void action.run(async () => {
      try {
        const answer = await sendJson("POST", "/api/draws", {
          memberId: form.value("memberId") || chosenMember?.id,
          phlebotomistId: form.value("phlebotomistId"),
          date,
          time: form.value("time"),
          ...(zone ? pastDrawFields(form, zone, date) : {}),
        }, DrawAnswer);
        closeDialog();
        navigate(`/staff/draws/${answer.draw.id}`);
        return `Draw booked for ${staffTime(answer.draw)}.`;
      } catch (error) {
        form.set("time", "");
        await slots.reload();
        throw error;
      }
    });
  };

  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <DialogMessage action={action} />
      {chooseMember ? (
        <SelectField form={form} name="memberId" label="Member" problem={action.problem} prompt="Choose a member" choices={(members.data?.members ?? []).filter((entry) => entry.accountState === "active").map((entry) => ({ value: entry.id, label: entry.name }))} />
      ) : null}
      <SelectField form={form} name="phlebotomistId" label="Phlebotomist" problem={action.problem} prompt="Choose a phlebotomist" choices={serving.map((entry) => ({ value: entry.id, label: entry.name }))} />
      <TextField form={form} name="date" label="Date" problem={action.problem} hint="As YYYY-MM-DD" inputMode="numeric" />
      <SlotChoices form={form} action={action} slots={slots.data?.slots ?? []} zone={zone} phlebotomistId={form.value("phlebotomistId")} />
      {isPast ? <PastDrawFields form={form} action={action} /> : null}
      <Button type="submit" action={action}>Book draw</Button>
    </form>
  );
}

export function MemberBookDraw({ zone }: { zone: TimeZone }) {
  return (
    <Dialog id="book-draw" title="Book draw">
      <MemberBookDrawBody zone={zone} />
    </Dialog>
  );
}

function MemberBookDrawBody({ zone }: { zone: TimeZone }) {
  const form = useForm("book-draw", { phlebotomistId: "", date: "", time: "" });
  const action = useAction();
  const date = form.value("date");
  const tomorrow = addDays(localDate(serverNow(), zone), 1);
  // The next two days always hold a working day, so they name everyone who serves this member.
  const serversSeen = useLoad(async () => {
    const days = await Promise.all([tomorrow, addDays(tomorrow, 1)].map((day) => getJson(`/api/me/slots?date=${day}`, SlotsAnswer)));
    return days.flatMap((day) => day.slots);
  }, `my-servers-${tomorrow}`, false);
  const slots = useLoad(async () => (isIsoDate(date) ? getJson(`/api/me/slots?date=${date}`, SlotsAnswer) : { slots: [] }), `my-slots-${date}`);
  const found = slots.data?.slots ?? [];
  const serving = [...new Map((serversSeen.data ?? []).map((slot) => [slot.phlebotomistId, slot.phlebotomistName])).entries()];
  const submit = (): void => {
    void action.run(async () => {
      try {
        const answer = await sendJson("POST", "/api/me/draws", { phlebotomistId: form.value("phlebotomistId"), date, time: form.value("time") }, DrawAnswer);
        closeDialog();
        navigate(`/me/draws/${answer.draw.id}`);
        return `Draw booked for ${memberTime(answer.draw)}.`;
      } catch (error) {
        form.set("time", "");
        await slots.reload();
        throw error;
      }
    });
  };
  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <DialogMessage action={action} />
      <SelectField form={form} name="phlebotomistId" label="Phlebotomist" problem={action.problem} prompt="Choose a phlebotomist" choices={serving.map(([value, label]) => ({ value, label }))} />
      <TextField form={form} name="date" label="Date" problem={action.problem} hint="As YYYY-MM-DD" inputMode="numeric" />
      <SlotChoices form={form} action={action} slots={found} zone={zone} phlebotomistId={form.value("phlebotomistId")} />
      <Button type="submit" action={action}>Book draw</Button>
    </form>
  );
}

export function MoveDrawDialog({ draw, audience, onMoved }: { draw: DrawView; audience: "staff" | "member"; onMoved: () => Promise<void> }) {
  return (
    <Dialog id="move-draw" title="Move draw">
      <MoveDrawBody draw={draw} audience={audience} onMoved={onMoved} />
    </Dialog>
  );
}

function MoveDrawBody({ draw, audience, onMoved }: { draw: DrawView; audience: "staff" | "member"; onMoved: () => Promise<void> }) {
  const form = useForm("move-draw", { date: "", time: "", collectedTime: "", kitCode: "" });
  const action = useAction();
  const date = form.value("date");
  const slotsPath = audience === "staff" ? `/api/slots?memberId=${draw.memberId}&date=${date}` : `/api/me/slots?date=${date}`;
  const slots = useLoad(async () => (isIsoDate(date) ? getJson(slotsPath, SlotsAnswer) : { slots: [] }), `move-slots-${date}`);
  const submit = (): void => {
    void action.run(async () => {
      try {
        const path = audience === "staff" ? `/api/draws/${draw.id}` : `/api/me/draws/${draw.id}`;
        const answer = await sendJson("PATCH", path, { date, time: form.value("time"), ...(audience === "staff" ? pastDrawFields(form, draw.timeZone, date) : {}) }, DrawAnswer);
        await onMoved();
        closeDialog();
        return `Draw moved to ${audience === "staff" ? staffTime(answer.draw) : memberTime(answer.draw)}.`;
      } catch (error) {
        form.set("time", "");
        await slots.reload();
        throw error;
      }
    });
  };
  return (
    <form className="stack" noValidate onSubmit={onSubmit(submit)}>
      <DialogMessage action={action} />
      <TextField form={form} name="date" label="Date" problem={action.problem} hint="As YYYY-MM-DD" inputMode="numeric" />
      <SlotChoices form={form} action={action} slots={slots.data?.slots ?? []} zone={draw.timeZone} phlebotomistId={draw.phlebotomistId} />
      {audience === "staff" && isIsoDate(date) && date < localDate(serverNow(), draw.timeZone) ? <PastDrawFields form={form} action={action} /> : null}
      <Button type="submit" action={action}>Move draw</Button>
    </form>
  );
}

export function CancelDrawDialog({ draw, audience, onCancelled }: { draw: DrawView; audience: "staff" | "member"; onCancelled: () => Promise<void> }) {
  const action = useAction();
  const confirm = (): void => {
    void action.run(async () => {
      await sendJson("POST", audience === "staff" ? `/api/draws/${draw.id}/cancel` : `/api/me/draws/${draw.id}/cancel`, {}, DrawAnswer);
      await onCancelled();
      closeDialog();
      return "Draw cancelled.";
    });
  };
  return (
    <Dialog id="cancel-draw" title="Cancel draw" action={action}>
      <p>This draw on {formatDate(draw.localDate)} will be cancelled.</p>
      <Button action={action} onClick={confirm}>Yes, cancel this draw</Button>
    </Dialog>
  );
}
