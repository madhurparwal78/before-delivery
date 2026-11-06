import { useState } from 'react';
import { fill, PRIVATE_COPY } from '../../shared/copy';
import { announce } from '../announce';
import { api } from '../api';
import { useLive } from '../live';
import { AsyncButton, BottomBar, Heading, LoadingBars, NotFound, Problems, TextField, ThumbMask, useForm } from '../ui/kit';
import { EndedPage, pageLanguage, PrivateShell } from './private';

interface SignOffRead {
  language: string;
  jobTitle: string;
  cut: number;
  frameRate: string;
  endsAt: string;
  signedOffAt: string | null;
  signedOffText: string | null;
  frames: { number: number; position: number; durationFrames: number; timecodeIn: string; actionNote: string; drawingUrl: string | null }[];
}

export function SignOffPage({ token }: { token: string }) {
  const copy = PRIVATE_COPY[pageLanguage()];
  const live = useLive(() => api<SignOffRead>(`/api/s/${token}`));
  const form = useForm(null, () => ({ name: '' }));
  const [signedText, setSignedText] = useState<string | null>(null);
  if (live.failedStatus === 410) return <EndedPage token={token} canAsk={false} />;
  if (live.failedStatus === 404) return <NotFound />;
  if (!live.data) return <PrivateShell copy={copy}><LoadingBars /></PrivateShell>;
  const { data } = live;
  const shownText = signedText ?? data.signedOffText;
  const sign = () =>
    form.submit(async () => {
      const answer = await api<{ signedOffText: string }>(`/api/s/${token}/sign`, { method: 'POST', body: { name: form.values.name } });
      setSignedText(answer.signedOffText);
      announce(answer.signedOffText);
      await live.reload();
    });
  return (
    <PrivateShell copy={copy}>
      <Heading title={fill(copy.signOffHeading, { title: data.jobTitle })} refreshFailed={live.refreshFailed} />
      <Problems form={form} />
      {shownText ? <p className="signed-line">{shownText}</p> : <TextField form={form} name="name" label={copy.nameField} autoComplete="name" />}
      <ul className="signoff-frames">
        {data.frames.map((frame) => (
          <li key={frame.number}>
            <ThumbMask src={frame.drawingUrl} />
            <p><strong className="tabular" dir="ltr">{frame.number}</strong> <span className="tabular" dir="ltr">{frame.timecodeIn}</span></p>
            <p>{frame.actionNote}</p>
          </li>
        ))}
      </ul>
      {shownText ? null : <BottomBar><AsyncButton label={copy.signOffButton} onPress={sign} /></BottomBar>}
    </PrivateShell>
  );
}
