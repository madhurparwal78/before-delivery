import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { request, type Item, type MemberSummary } from "../api";
import { ActionButton, Dialog, FieldMessage, FormProblems, type Problem } from "../components/ui";
import { readReturnTime } from "../returnTime";
import { PhotoPicker } from "./PhotoPicker";

export interface NewLoanEntries {
  member: MemberSummary | null;
  tools: Item[];
  photo: File | null;
  checkedOutAt: string;
}

export type NewLoanOutcome =
  | { kind: "out" }
  | { kind: "refused"; problems?: Problem[] }
  | { kind: "ended" };

interface Props {
  items: Item[];
  initialTools: Item[];
  coordinator: boolean;
  zone: string;
  /** Reserves then checks out; returns how the dialog should react. */
  onCheckOut: (entries: NewLoanEntries, setPhase: (phase: "reserving" | "checking-out" | null) => void) => Promise<NewLoanOutcome>;
  onClose: () => void;
}

export function NewLoanDialog({ items, initialTools, coordinator, zone, onCheckOut, onClose }: Props) {
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [query, setQuery] = useState("");
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [tagText, setTagText] = useState("");
  const [tagMessage, setTagMessage] = useState("");
  const [tools, setTools] = useState<Item[]>(initialTools);
  const [photo, setPhoto] = useState<File | null>(null);
  const [checkedOutAt, setCheckedOutAt] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [phase, setPhase] = useState<"reserving" | "checking-out" | null>(null);
  const [prompt, setPrompt] = useState(false);
  const memberBox = useRef<HTMLInputElement>(null);
  const tagBox = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const beforePrompt = useRef<HTMLElement | null>(null);
  const focusNext = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    void request<{ members: MemberSummary[] }>("GET", "/api/members").then((answer) => answer.status === 200 && setMembers(answer.body.members));
  }, []);
  useLayoutEffect(() => {
    if (focusNext.current) {
      focusNext.current.focus();
      focusNext.current = null;
    }
  });

  const needle = query.trim().toLowerCase();
  const matches = needle && member?.name !== query ? members.filter((m) => m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle)) : [];
  const showList = listOpen && matches.length > 0;
  const hasEntries = member !== null || tools.length > 0 || photo !== null;

  const pick = (m: MemberSummary) => {
    setMember(m);
    setQuery(m.name);
    setListOpen(false);
    setActive(-1);
    focusNext.current = tagBox.current;
  };

  const addTag = () => {
    const tag = tagText.trim().toUpperCase();
    if (tag === "") return;
    const item = items.find((i) => i.tag.toUpperCase() === tag);
    if (!item) setTagMessage(`No tool has tag ${tag}.`);
    else if (tools.some((t) => t.id === item.id)) setTagMessage(`${tag} is already on this loan.`);
    else {
      setTools([...tools, item]);
      setTagText("");
    }
  };

  const leave = () => {
    if (!hasEntries) {
      onClose();
      return;
    }
    beforePrompt.current = document.activeElement as HTMLElement | null;
    setPrompt(true);
  };

  const checkOut = async () => {
    const missing: Problem[] = [];
    if (!member) missing.push({ field: "member", label: "Member", message: "Choose the member borrowing.", target: "new-loan-member" });
    if (tools.length === 0) missing.push({ field: "tools", label: "Add tool by tag", message: "Add at least one tool.", target: "new-loan-tag" });
    if (!photo) missing.push({ field: "photo", label: "Photo", message: "Take or choose the checkout photo.", target: "new-loan-photo" });
    const typedTime = readReturnTime(checkedOutAt, zone);
    if (typedTime.kind === "malformed" || typedTime.kind === "skipped") {
      missing.push({ field: "checked_out_at", label: "Checked out at", message: "Use YYYY-MM-DD HH:MM in library time.", target: "new-loan-checked-out" });
    }
    if (missing.length) {
      setProblems(missing);
      focusNext.current = summary.current;
      return;
    }
    setProblems([]);
    const outcome = await onCheckOut({ member, tools, photo, checkedOutAt }, setPhase);
    if (outcome.kind === "refused") {
      if (outcome.problems) {
        setProblems(outcome.problems);
        focusNext.current = summary.current;
      } else memberBox.current?.focus();
    }
  };

  const listId = "members-list";
  return (
    <>
      <Dialog label="New loan" wide onEscape={() => (showList ? setListOpen(false) : leave())} initial={memberBox}>
        <div class="newloan">
          <h2 class="dialog-title">New loan</h2>
          <FormProblems problems={problems} summaryRef={summary} />
          <label class="field" for="new-loan-member">
            <span class="field-label">Member</span>
          </label>
          <input
            id="new-loan-member"
            ref={memberBox}
            role="combobox"
            aria-label="Member"
            aria-autocomplete="list"
            aria-expanded={showList ? "true" : "false"}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 && matches[active] ? `member-option-${matches[active]!.id}` : undefined}
            autoComplete="off"
            value={query}
            onFocus={() => setListOpen(true)}
            onBlur={() => setListOpen(false)}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setMember(null);
              setListOpen(true);
              setActive(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!showList) {
                  setListOpen(true);
                  return;
                }
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive((current) => (current < 0 && step < 0 ? matches.length - 1 : (current + step + matches.length) % matches.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const chosen = showList ? matches[active] : undefined;
                if (chosen) pick(chosen);
              }
            }}
          />
          {showList && (
            <ul role="listbox" id={listId} aria-label="Members" class="members-list">
              {matches.map((m, index) => (
                <li
                  key={m.id}
                  role="option"
                  id={`member-option-${m.id}`}
                  aria-selected={index === active ? "true" : "false"}
                  class={index === active ? "is-active" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(m)}
                >
                  {m.name} ({m.email})
                </li>
              ))}
            </ul>
          )}
          <label class="field">
            <span class="field-label">Add tool by tag</span>
            <input
              id="new-loan-tag"
              ref={tagBox}
              class="num"
              autoComplete="off"
              value={tagText}
              aria-describedby={tagMessage ? "new-loan-tag-message" : undefined}
              onInput={(e) => {
                setTagText(e.currentTarget.value);
                setTagMessage("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
            />
          </label>
          <FieldMessage id="new-loan-tag" message={tagMessage} />
          <ul aria-label="Tools on this loan" class="loan-tools">
            {tools.map((tool) => (
              <li key={tool.id}>
                <span>
                  <span class="num">{tool.tag}</span> {tool.name}
                </span>
                <button type="button" class="btn btn-small" onClick={() => setTools(tools.filter((t) => t.id !== tool.id))}>
                  Remove {tool.tag}
                </button>
              </li>
            ))}
          </ul>
          {coordinator && (
            <label class="field">
              <span class="field-label">Checked out at</span>
              <input
                id="new-loan-checked-out"
                class="num"
                placeholder="YYYY-MM-DD HH:MM (paper slips only)"
                value={checkedOutAt}
                onInput={(e) => setCheckedOutAt(e.currentTarget.value)}
              />
            </label>
          )}
          <PhotoPicker photo={photo} onPick={setPhoto} id="new-loan-photo" />
          <div class="dialog-actions">
            <ActionButton
              label="Check out"
              pendingLabel={phase === "checking-out" ? "Checking out..." : "Reserving..."}
              pending={phase !== null}
              primary
              onAct={() => void checkOut()}
            />
            <button type="button" class="btn" onClick={leave}>
              Discard
            </button>
          </div>
        </div>
      </Dialog>
      {prompt && (
        <Dialog
          role="alertdialog"
          label="Discard this loan?"
          initial={keepEditing}
          describedBy="discard-text"
          onEscape={() => {
            setPrompt(false);
            focusNext.current = beforePrompt.current;
          }}
        >
          <p id="discard-text">Discard this loan? The member, tools and photo you entered will be cleared.</p>
          <div class="dialog-actions">
            <button
              type="button"
              class="btn"
              ref={keepEditing}
              onClick={() => {
                setPrompt(false);
                focusNext.current = beforePrompt.current;
              }}
            >
              Keep editing
            </button>
            <button type="button" class="btn btn-primary" onClick={onClose}>
              Discard loan
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
