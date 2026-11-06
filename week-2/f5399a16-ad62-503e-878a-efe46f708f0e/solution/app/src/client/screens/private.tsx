// What the three private pages share: the language, the wordmark and the ended page.

import { useMemo, useState, type ReactNode } from 'react';
import { PRIVATE_COPY, type Language, type PrivateCopy } from '../../shared/copy';
import { announce } from '../announce';
import { api } from '../api';
import { Heading, Problems, TextField, WordsContext, classOf, useForm } from '../ui/kit';

export function pageLanguage(): Language {
  return document.documentElement.lang as Language;
}

export function PrivateShell({ copy, children }: { copy: PrivateCopy; children: ReactNode }) {
  const words = useMemo(() => ({ working: copy.working, problems: copy.problems, refreshLine: copy.refreshLine }), [copy]);
  return (
    <WordsContext.Provider value={words}>
      <main className="private-page">
        <div className="clap-band private-band" aria-hidden="true" />
        <p className="wordmark">Noor Bakker Boards</p>
        {children}
      </main>
    </WordsContext.Provider>
  );
}

export function EndedPage({ token, canAsk }: { token: string; canAsk: boolean }) {
  const copy = PRIVATE_COPY[pageLanguage()];
  const form = useForm(null, () => ({ email: '' }));
  const [answered, setAnswered] = useState<string | null>(null);
  const ask = () =>
    form.submit(async () => {
      const answer = await api<{ message: string }>(`/api/r/${token}/new-link`, { method: 'POST', body: { email: form.values.email } });
      announce(answer.message);
      setAnswered(answer.message);
    });
  return (
    <PrivateShell copy={copy}>
      <Heading title={copy.ended} />
      {canAsk ? (
        <form noValidate onSubmit={(event) => { event.preventDefault(); void ask(); }}>
          <Problems form={form} />
          <TextField form={form} name="email" label={copy.mailField} autoComplete="email" inputMode="email" />
          <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}>{form.busy ? copy.working : copy.askLink}</button>
          {answered ? <p className="thanks">{answered}</p> : null}
        </form>
      ) : null}
    </PrivateShell>
  );
}
