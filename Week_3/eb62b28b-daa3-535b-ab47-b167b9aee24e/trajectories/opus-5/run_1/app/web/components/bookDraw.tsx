import { RefObject, useEffect, useState } from 'react';
import { api } from '../app/api';
import { useAnnounce, useRemembered } from '../app/shell';
import { Overlay } from './overlays';
import { DialogMessage, RadioGroup, SelectField, TextField } from './pieces';
import {
  DrawView,
  MemberView,
  PhlebotomistView,
  SlotView,
  copy,
  displayDate,
  localTime,
  PRACTICE_ZONE,
  twoTimeForm,
  zoneCity,
} from '../app/types';

export function bookedAnnouncement(draw: DrawView, asStaff: boolean, moved: boolean): string {
  const date = displayDate(draw.localDate);
  const phoenixTime = localTime(new Date(draw.startsAt), PRACTICE_ZONE);
  if (asStaff) {
    const form = twoTimeForm(date, phoenixTime, draw.localTime, draw.timeZone);
    return moved ? copy.drawMovedStaff(form) : copy.drawBookedStaff(form);
  }
  return moved
    ? copy.drawMovedMember(date, draw.localTime, draw.timeZone)
    : copy.drawBookedMember(date, draw.localTime, draw.timeZone);
}

export interface BookDrawProps {
  name: 'Book draw' | 'Move draw';
  open: boolean;
  onClose: () => void;
  opener: RefObject<HTMLElement>;
  asStaff: boolean;
  members: MemberView[];
  member: MemberView | null;
  onPickMember?: (memberId: string) => void;
  draw?: DrawView | null;
  onDone: (draw: DrawView) => void;
}

export function BookDrawDialog({
  name,
  open,
  onClose,
  opener,
  asStaff,
  members,
  member,
  onPickMember,
  draw,
  onDone,
}: BookDrawProps): JSX.Element {
  const { announce } = useAnnounce();
  const [phlebotomists, setPhlebotomists] = useState<PhlebotomistView[]>([]);
  const [phlebotomistId, setPhlebotomistId] = useRemembered(
    `book-phlebotomist:${draw?.id ?? 'new'}`,
    draw?.phlebotomistId ?? '',
  );
  const [date, setDate] = useRemembered(`book-date:${draw?.id ?? 'new'}`, draw?.localDate ?? '');
  const [time, setTime] = useRemembered(`book-time:${draw?.id ?? 'new'}`, draw?.localTime ?? '');
  const [slots, setSlots] = useState<SlotView[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const load = async (): Promise<void> => {
      const result = await api<{ phlebotomists: PhlebotomistView[] }>('/api/phlebotomists');
      const all = result.data?.phlebotomists ?? [];
      setPhlebotomists(
        member?.state ? all.filter((entry) => entry.states.includes(member.state as string)) : all,
      );
    };
    void load();
  }, [open, member?.state]);

  const readSlots = async (): Promise<void> => {
    if (!open || date === '' || !member) return;
    const path = asStaff
      ? `/api/slots?memberId=${member.id}&date=${date}`
      : `/api/me/slots?date=${date}`;
    const result = await api<{ slots: SlotView[] }>(path);
    setSlots(result.data?.slots ?? []);
  };

  useEffect(() => {
    void readSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date, member?.id, phlebotomistId]);

  const city = member?.timeZone ? zoneCity(member.timeZone) : 'Phoenix';
  const free = slots.filter(
    (slot) => slot.phlebotomistId === phlebotomistId && (slot.free || slot.localTime === draw?.localTime),
  );

  const submit = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    announce(copy.working);
    const body: Record<string, unknown> = { phlebotomistId, date, time };
    if (asStaff && member) body.memberId = member.id;
    const path = draw
      ? asStaff
        ? `/api/draws/${draw.id}`
        : `/api/me/draws/${draw.id}`
      : asStaff
        ? '/api/draws'
        : '/api/me/draws';
    const result = await api<{ draw: DrawView }>(path, {
      method: draw ? 'PATCH' : 'POST',
      json: body,
    });
    setBusy(false);
    if (result.error) {
      setFields(result.error.fields ?? {});
      setMessage(result.error.fields ? null : result.error.message);
      announce(result.error.message);
      await readSlots();
      return;
    }
    setFields({});
    if (result.data) {
      announce(bookedAnnouncement(result.data.draw, asStaff, Boolean(draw)));
      onDone(result.data.draw);
    }
  };

  return (
    <Overlay name={name} open={open} onClose={onClose} opener={opener}>
      <h2>{name}</h2>
      <DialogMessage text={message} />
      {asStaff && onPickMember ? (
        <SelectField
          label="Member"
          name="member"
          value={member?.id ?? ''}
          onChange={onPickMember}
          options={[
            { value: '', label: 'Choose a member' },
            ...members.map((entry) => ({ value: entry.id, label: entry.name ?? '' })),
          ]}
        />
      ) : null}
      <SelectField
        label="Phlebotomist"
        name="phlebotomist"
        value={phlebotomistId}
        error={fields.phlebotomistId}
        onChange={setPhlebotomistId}
        options={[
          { value: '', label: 'Choose a phlebotomist' },
          ...phlebotomists.map((entry) => ({ value: entry.id, label: entry.name })),
        ]}
      />
      <TextField label="Date" name="date" value={date} error={fields.date} onChange={setDate} />
      <RadioGroup
        label="Time"
        name="time"
        value={time}
        error={fields.time}
        onChange={setTime}
        options={free.map((slot) => ({
          value: slot.localTime,
          label: `${slot.localTime} ${city} time`,
        }))}
      />
      <button type="button" disabled={busy} onClick={() => void submit()}>
        {name === 'Move draw' ? 'Move draw' : 'Book draw'}
      </button>
    </Overlay>
  );
}
