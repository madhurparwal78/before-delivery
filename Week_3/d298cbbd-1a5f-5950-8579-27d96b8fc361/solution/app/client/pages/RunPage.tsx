import type { JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { replayLog } from "../../shared/engine";
import type { EngineRules } from "../../shared/engine";
import { REFUSAL_REASONS, twoDecimals } from "../../shared/format";
import { fromHundredths, numberHundredths } from "../../shared/numbers";
import type { StoredRun } from "../../shared/protocol";
import { ApiError, api } from "../api";
import { Certificate, figuresOf } from "../components/Certificate";
import type { CertificateInput, Figures } from "../components/Certificate";
import { Link, navigate } from "../router";
import { useStore } from "../store";
import { viewer } from "../viewer";

const dash = (value: number | null): string => (value === null ? "-" : twoDecimals(value));

/** What a stored run shows: the replay's figures when it can be replayed, the stored figures otherwise. */
function inputOf(run: StoredRun, maxExtraLetters: number): CertificateInput {
  const seal: CertificateInput["seal"] = run.verdict === "counted" ? { kind: "counted", personalBest: false } : { kind: "refused", reason: REFUSAL_REASONS[run.reason ?? ""] ?? "something went wrong." };
  const common = { seal, proofKey: run.proofKey, finishedAt: run.finishedAt };
  if (run.verdict === "counted" && run.proofKey !== null && Array.isArray(run.log)) {
    const rules: EngineRules = { timeLimitMs: run.mode === "time" ? Number(run.length) * 1000 : null, maxExtraLetters };
    const { score } = replayLog(run.words, run.log as { k: string; t: number }[], rules);
    if (score) {
      return { ...common, figures: figuresOf(score, twoDecimals(fromHundredths(numberHundredths(score.consistency)))), replay: { words: run.words, log: run.log as { k: string; t: number }[], rules, score } };
    }
  }
  const characters = run.characters ? [run.characters.correct, run.characters.incorrect, run.characters.extra, run.characters.missed].map((n) => (n === null ? "-" : String(n))).join("/") : "-";
  const figures: Figures = {
    speed: dash(run.speed),
    raw: dash(run.raw),
    accuracy: run.accuracy === null ? "-" : `${twoDecimals(run.accuracy)}%`,
    consistency: run.consistency === null ? "-" : `${twoDecimals(run.consistency)}%`,
    characters,
    duration: run.duration === null ? "-" : `${twoDecimals(run.duration / 1000)} s`,
  };
  return { ...common, figures, replay: null };
}

export function RunPage({ id }: { id: string }): JSX.Element {
  const { me } = useStore(viewer.state);
  const config = useStore(viewer.config);
  const [state, setState] = useState<{ input: CertificateInput; start: number | null } | "missing" | null>(null);

  useLayoutEffect(() => {
    setState(null);
    if (!me) return setState("missing");
    api<StoredRun>("GET", `/api/runs/${id}`).then(
      (run) => {
        const input = inputOf(run, config.maxExtraLetters);
        const max = input.replay?.score.perSecond.length ?? 0;
        const asked = new URLSearchParams(window.location.search).get("at");
        let start: number | null = null;
        if (input.replay && asked !== null) {
          const parsed = /^-?\d+$/.test(asked) ? Number(asked) : max;
          start = Math.min(max, Math.max(0, parsed));
          if (String(start) !== asked) navigate(`/runs/${id}?at=${start}`, true);
        }
        setState({ input, start });
      },
      (error: unknown) => {
        if (error instanceof ApiError) setState("missing");
      },
    );
  }, [id, me?.id]);

  if (state === "missing") {
    return (
      <section class="paper narrow">
        <h1 class="page-title">No such run.</h1>
        <Link href="/history" class="button">Back to history</Link>
      </section>
    );
  }
  if (state === null) return <p class="loading" aria-busy="true">Opening run.</p>;
  return <Certificate key={id} input={state.input} initialAt={state.start} animate={false} onPosition={(second) => navigate(`/runs/${id}?at=${second}`, true)} />;
}
