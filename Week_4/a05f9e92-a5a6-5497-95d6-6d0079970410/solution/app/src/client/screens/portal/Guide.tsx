import { useEffect, useMemo, useRef, useState } from "react";
import type { Value } from "../../../shared/expression.js";
import type { Guide as GuideJson } from "../../../server/catalog.js";
import type { FormPolicy } from "../../../server/rules.js";
import { ApiFailure, del, failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { navigate } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, Page, Rest, useLoad } from "../../lib/ui.js";
import { gate, PortalActions, refreshCart } from "./common.js";
import { settle, startingValues, submittedValues, variableId, variableProblems, VariableFields, type ItemVariable, type ShownItem } from "./ItemForm.js";
import { applyPolicies, policiesFor, type FieldState } from "./policy.js";

type ShownGuide = Omit<GuideJson, "questions"> & { questions: ItemVariable[] };

/** The longest the groups wait after an answer changes before they are refreshed. */
const REFRESH_DELAY_MS = 150;

interface Problem {
  id: string;
  group: string | null;
  message: string;
}

interface Loaded {
  guide: ShownGuide;
  items: ShownItem[];
  policies: FormPolicy[];
}

function itemPrefix(item: ShownItem): string {
  return `item-${item.id}`;
}

function GuideForm({ guide, items, policies }: Loaded): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const username = session.user?.username ?? "";
  const roles = session.user?.roles ?? [];
  const [answers, setAnswers] = useState(() => startingValues(guide.questions));
  const [resolved, setResolved] = useState<string[]>([]);
  const [valuesByItem, setValuesByItem] = useState<Record<string, Record<string, Value>>>({});
  const [problems, setProblems] = useState<Problem[]>([]);
  const [problemsNonce, setProblemsNonce] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** True while Add all to cart runs, so a second activation cannot add every line again. */
  const adding = useRef(false);
  const problemsGroup = useRef<HTMLDivElement>(null);
  const resolveUrl = `/api/catalog/guides/${encodeURIComponent(guide.id)}/resolve`;

  const shown = useMemo(() => resolved.flatMap((id) => items.filter((item) => item.id === id)), [resolved, items]);
  const valuesFor = (item: ShownItem): Record<string, Value> => valuesByItem[item.id] ?? startingValues(item.variables);
  const statesFor = (item: ShownItem, values: Record<string, Value>): Record<string, FieldState> => applyPolicies(policiesFor(policies, item.id), values, username, roles);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      post<{ items: string[] }>(resolveUrl, { answers }).then(
        ({ items: ids }) => current && setResolved(ids),
        () => current && setResolved([]),
      );
    }, REFRESH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [answers, resolveUrl]);

  useEffect(() => {
    if (problems.length > 0) problemsGroup.current?.focus();
  }, [problemsNonce, problems.length]);

  const changeAnswer = (name: string, value: Value): void => setAnswers((current) => settle(guide.questions, { ...current, [name]: value }));
  const changeItem = (item: ShownItem, name: string, value: Value): void =>
    setValuesByItem((current) => ({ ...current, [item.id]: settle(item.variables, { ...(current[item.id] ?? startingValues(item.variables)), [name]: value }) }));

  const refuse = (found: Problem[]): void => {
    setBusy(false);
    setProblems(found);
    setProblemsNonce((n) => n + 1);
    announce(`${found.length} problems to fix before saving.`);
  };

  const addAll = async (): Promise<void> => {
    if (adding.current) return;
    adding.current = true;
    try {
      await addAllOnce();
    } finally {
      adding.current = false;
    }
  };

  const addAllOnce = async (): Promise<void> => {
    setBusy(true);
    setProblems([]);
    setFailure(null);
    let ids: string[];
    try {
      ids = (await post<{ items: string[] }>(resolveUrl, { answers })).items;
    } catch (error) {
      const fields = error instanceof ApiFailure ? (error.fields ?? {}) : {};
      const found = guide.questions.filter((question) => fields[question.name] !== undefined).map((question) => ({ id: variableId("question", question.name), group: null, message: fields[question.name]! }));
      if (found.length > 0) refuse(found);
      else setBusy(false);
      return;
    }
    setResolved(ids);
    const chosen = ids.flatMap((id) => items.filter((item) => item.id === id));
    const found: Problem[] = [];
    const questionIssues = variableProblems(guide.questions, answers, {});
    for (const question of guide.questions) {
      const message = questionIssues[question.name];
      if (message) found.push({ id: variableId("question", question.name), group: null, message });
    }
    for (const item of chosen) {
      const values = valuesFor(item);
      const issues = variableProblems(item.variables, values, statesFor(item, values));
      for (const variable of item.variables) {
        const message = issues[variable.name];
        if (message) found.push({ id: variableId(itemPrefix(item), variable.name), group: item.name, message });
      }
    }
    if (found.length > 0) {
      refuse(found);
      return;
    }
    const added: number[] = [];
    let failing: ShownItem | undefined;
    try {
      for (const item of chosen) {
        failing = item;
        const values = valuesFor(item);
        const { line } = await post<{ line: { id: number } }>("/api/cart/lines", { item: item.id, quantity: 1, variables: submittedValues(item.variables, values, statesFor(item, values)) });
        added.push(line.id);
      }
    } catch (error) {
      for (const lineId of added) await del(`/api/cart/lines/${lineId}`).catch(() => undefined);
      const fields = error instanceof ApiFailure ? (error.fields ?? {}) : {};
      const refused = failing ? failing.variables.filter((variable) => fields[variable.name] !== undefined).map((variable) => ({ id: variableId(itemPrefix(failing!), variable.name), group: failing!.name, message: fields[variable.name]! })) : [];
      if (refused.length > 0) refuse(refused);
      else {
        setBusy(false);
        setFailure(failureText(error));
      }
      return;
    }
    await refreshCart(username);
    navigate("/portal/cart");
  };

  const errorOf = (id: string): string | undefined => problems.find((problem) => problem.id === id)?.message;
  const errorsFor = (prefix: string, variables: ItemVariable[]): Record<string, string> => {
    const found: Record<string, string> = {};
    for (const variable of variables) {
      const message = errorOf(variableId(prefix, variable.name));
      if (message) found[variable.name] = message;
    }
    return found;
  };

  return (
    <form
      className="item-form guide-form"
      aria-label={guide.name}
      onSubmit={(event) => {
        event.preventDefault();
        void addAll();
      }}
      noValidate
    >
      <VariableFields prefix="question" variables={guide.questions} values={answers} states={{}} errors={errorsFor("question", guide.questions)} onChange={changeAnswer} />
      {shown.map((item) => {
        const values = valuesFor(item);
        const prefix = itemPrefix(item);
        return (
          <div key={item.id} role="group" aria-labelledby={`${prefix}-title`} className="guide-group">
            <h2 id={`${prefix}-title`}>{item.name}</h2>
            <VariableFields prefix={prefix} variables={item.variables} values={values} states={statesFor(item, values)} errors={errorsFor(prefix, item.variables)} onChange={(name, value) => changeItem(item, name, value)} />
          </div>
        );
      })}
      {problems.length > 0 ? (
        <div ref={problemsGroup} role="group" aria-label="Problems to fix" tabIndex={-1} className="rf-problems">
          <p>{problems.length} problems to fix before saving.</p>
          <ul>
            {problems.map((problem) => (
              <li key={`${problem.id}:${problem.message}`}>
                <a
                  href={`#${problem.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(problem.id)?.focus();
                  }}
                >
                  {problem.group ? `${problem.group}: ` : ""}
                  {problem.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failure ? <p className="form-error">{failure}</p> : null}
      <div className="row">
        <Button type="submit" busy={busy}>
          Add all to cart
        </Button>
      </div>
    </form>
  );
}

export function Guide({ id }: { id: string }): JSX.Element {
  const session = useSession();
  const { state, reload } = useLoad(async () => {
    const [{ guide }, { items }, { form_policies }] = await Promise.all([
      get<{ guide: ShownGuide }>(`/api/catalog/guides/${encodeURIComponent(id)}`),
      get<{ items: ShownItem[] }>("/api/catalog/items"),
      get<{ form_policies: FormPolicy[] }>("/api/form-policies"),
    ]);
    return { guide, items, policies: form_policies };
  }, [id, session.accessVersion]);
  if (state.status !== "ready") return gate(state, id, reload);
  return (
    <Page subject={state.data.guide.name}>
      <PortalActions />
      <Rest narrow className="portal-column">
        <GuideForm key={state.data.guide.id} {...state.data} />
      </Rest>
    </Page>
  );
}
