import type { JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { Account, Settings } from "../../shared/protocol";
import { twoDecimals, utcDate } from "../../shared/format";
import { ApiError, api } from "../api";
import { Checkbox, RadioGroup } from "../components/Choices";
import { Link } from "../router";
import { useStore } from "../store";
import { viewer } from "../viewer";

export function NotFoundPage(): JSX.Element {
  return (
    <section class="paper narrow">
      <h1 class="page-title">Page not found</h1>
      <p>There is no such page in this drawer.</p>
      <Link href="/" class="button">Back to the Test folder</Link>
    </section>
  );
}

export function SettingsPage(): JSX.Element {
  const settings = useStore(viewer.settings);
  const set = (patch: Partial<Settings>) => () => viewer.change(patch);
  return (
    <section class="paper settings-sheet">
      <h1 class="page-title">Settings</h1>
      <p class="aside">Changes apply at once{viewer.state.get().me ? " and are kept on your account." : " and are kept in this browser."}</p>
      <div class="settings-groups">
        <h2 class="group-title">Theme</h2>
        <RadioGroup label="Theme" name="theme" value={settings.theme} options={["sand", "cobalt", "carbon", "ledger"] as const} onChange={(theme) => set({ theme })()} />
        <h2 class="group-title">Caret</h2>
        <RadioGroup label="Caret" name="caret" value={settings.caret} options={["line", "block", "underline", "off"] as const} onChange={(caret) => set({ caret })()} />
        <h2 class="group-title">Font size</h2>
        <RadioGroup label="Font size" name="font-size" value={settings.fontSize} options={[1, 1.5, 2, 3] as const} onChange={(fontSize) => set({ fontSize })()} />
        <h2 class="group-title">Quick restart</h2>
        <RadioGroup label="Quick restart" name="quick-restart" value={settings.quickRestart} options={["tab", "enter"] as const} onChange={(quickRestart) => set({ quickRestart })()} />
        <h2 class="group-title">Caret and text</h2>
        <Checkbox label="Smooth caret" checked={settings.smoothCaret} onChange={(smoothCaret) => set({ smoothCaret })()} />
        <Checkbox label="Blind mode" checked={settings.blindMode} onChange={(blindMode) => set({ blindMode })()} />
      </div>
    </section>
  );
}

export function AccountPage(): JSX.Element {
  const { me } = useStore(viewer.state);
  const [account, setAccount] = useState<Account | null>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    if (!me) return;
    api<Account>("GET", "/api/account").then(setAccount, (error: unknown) => {
      if (!(error instanceof ApiError) || error.status !== 401) setFailed(true);
    });
  }, [me?.id]);
  if (!me) {
    return (
      <section class="paper narrow">
        <h1 class="page-title">Account</h1>
        <p>Sign in to see your account.</p>
        <Link href="/signin" class="button">Sign in</Link>
      </section>
    );
  }
  return (
    <section class="paper">
      <h1 class="page-title">Account</h1>
      {failed && <p class="alert" role="alert">Something went wrong. Try again.</p>}
      {account && (
        <>
          <p class="aside">{account.name} · {account.email} · {account.verified ? "email verified" : "email not verified"}</p>
          <p id="tests-counted" class="big-count">Tests counted {account.testsCounted}</p>
          <div class="table-wrap">
            <table class="data-table wide" aria-label="Personal bests">
              <thead>
                <tr>
                  <th scope="col">Mode</th><th scope="col">Length</th><th scope="col">Punctuation</th><th scope="col">Numbers</th>
                  <th scope="col">Speed</th><th scope="col">Accuracy</th><th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {account.personalBests.map((best) => (
                  <tr key={best.runId}>
                    <td>{best.mode}</td>
                    <td>{best.length}</td>
                    <td>{best.punctuation ? "on" : "off"}</td>
                    <td>{best.numbers ? "on" : "off"}</td>
                    <td>{twoDecimals(best.speed)}</td>
                    <td>{twoDecimals(best.accuracy)}%</td>
                    <td>{utcDate(best.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
