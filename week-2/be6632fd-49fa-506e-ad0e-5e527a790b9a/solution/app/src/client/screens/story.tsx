// The story editor (brief: Staff screens → story; Interactions → Drafts and ended sessions; Journey 5).
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { COPY, staleStart } from "../../shared/copy";
import { marketTime } from "../../shared/format";
import { api } from "../api";
import { useDraft } from "../drafts";
import { Link } from "../router";
import type { StaffDrop } from "../types";
import { Button, Dialog, Field, Loading, PageTitle, StatusRegion, focusLater, refusalMessage, useMessage } from "../ui";

interface Story {
  html: string;
  version: number;
  savedBy: string | null;
  savedAt: string | null;
  publishedHtml: string | null;
  publishedAt: string | null;
}

const TOOLS: Array<[string, string, string]> = [
  ["Heading", "formatBlock", "h2"],
  ["Subheading", "formatBlock", "h3"],
  ["Bold", "bold", ""],
  ["Italic", "italic", ""],
  ["Bulleted list", "insertUnorderedList", ""],
  ["Numbered list", "insertOrderedList", ""],
];

export function StoryScreen({ id }: { id: string }): JSX.Element {
  const [drop, setDrop] = useState<StaffDrop | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const draft = useDraft<{ html: string } | null>("story", null);
  const [message, setMessage] = useMessage();
  const [busy, setBusy] = useState<"" | "save" | "publish">("");
  const [dialog, setDialog] = useState<"" | "link" | "publish">("");
  const [address, setAddress] = useState("");
  const version = useRef(1);
  const editor = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const publishButton = useRef<HTMLButtonElement>(null);
  const linkButton = useRef<HTMLButtonElement>(null);
  const restoredOnce = useRef(false);

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([api<StaffDrop>("GET", `/api/drops/${id}`), api<Story>("GET", `/api/drops/${id}/story`)]);
    if (d.ok) setDrop(d.data);
    if (s.ok) {
      setStory(s.data);
      version.current = s.data.version;
    } else setMessage(refusalMessage(s));
  }, [id, setMessage]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!story || !editor.current || editor.current.dataset.ready) return;
    editor.current.dataset.ready = "true";
    editor.current.innerHTML = draft.value?.html ?? story.html;
    document.execCommand("defaultParagraphSeparator", false, "p");
    if (draft.restored && draft.value && draft.value.html !== story.html && !restoredOnce.current) {
      restoredOnce.current = true;
      setMessage(COPY.draftRestored);
    }
  }, [story, draft.value, draft.restored, setMessage]);

  const keep = (): void => {
    draft.set({ html: editor.current?.innerHTML ?? "" });
  };
  const remember = (): void => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount && editor.current?.contains(selection.anchorNode)) range.current = selection.getRangeAt(0).cloneRange();
  };
  const restore = (): void => {
    const el = editor.current;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (range.current && selection) {
      selection.removeAllRanges();
      selection.addRange(range.current);
    }
  };
  const tool = (command: string, value: string): void => {
    const el = editor.current;
    if (!el) return;
    restore();
    if (command === "formatBlock" && !el.textContent?.trim()) {
      el.innerHTML = `<${value}><br></${value}>`;
      const caret = document.createRange();
      caret.setStart(el.firstChild as Node, 0);
      caret.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(caret);
    } else document.execCommand(command, false, value ? `<${value}>` : undefined);
    remember();
    keep();
  };
  const addLink = (event: FormEvent): void => {
    event.preventDefault();
    const href = address.trim();
    setDialog("");
    setAddress("");
    window.setTimeout(() => {
      restore();
      const selection = window.getSelection();
      if (!href || !selection) return;
      if (selection.isCollapsed) {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = href;
        const r = selection.getRangeAt(0);
        r.insertNode(a);
        r.setStartAfter(a);
        r.collapse(true);
        selection.removeAllRanges();
        selection.addRange(r);
      } else document.execCommand("createLink", false, href);
      remember();
      keep();
    }, 0);
  };
  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy("save");
    setMessage("Saving story…");
    const r = await api<Story>("PUT", `/api/drops/${id}/story`, { version: version.current, html: editor.current?.innerHTML ?? "" });
    setBusy("");
    if (r.ok) {
      version.current = r.data.version;
      setStory(r.data);
      draft.clear();
      setMessage(`Story saved at ${r.data.savedAt ? marketTime(Date.parse(r.data.savedAt)) : ""}.`);
      return;
    }
    if (r.status === 412) {
      version.current = (r.extra.current as Story).version;
      setMessage(`${staleStart(String(r.extra.savedBy), marketTime(Date.parse(String(r.extra.savedAt))))} Your text is still in the editor.`);
      return;
    }
    setMessage(r.status === 422 ? `${r.message} ${Object.values(r.fields).join(" ")}` : refusalMessage(r));
  };
  const publish = async (): Promise<void> => {
    if (busy) return;
    setBusy("publish");
    setMessage("Publishing…");
    const r = await api<Story>("POST", `/api/drops/${id}/story/publish`, { version: version.current });
    setBusy("");
    setDialog("");
    focusLater(() => publishButton.current);
    if (r.ok) {
      version.current = r.data.version;
      setStory(r.data);
      setMessage("Story published.");
      return;
    }
    if (r.status === 412) {
      version.current = (r.extra.current as Story).version;
      setMessage(`${staleStart(String(r.extra.savedBy), marketTime(Date.parse(String(r.extra.savedAt))))} Your text is still in the editor.`);
      return;
    }
    setMessage(refusalMessage(r));
  };
  if (!drop || !story) return <Loading />;
  return (
    <div className="screen">
      <div className="screen-head">
        <p className="eyebrow">
          <Link to="/studio/press">Press</Link> · {story.publishedAt ? `Published ${marketTime(Date.parse(story.publishedAt))}` : "Not published yet"}
        </p>
        <PageTitle>{`Story · ${drop.name}`}</PageTitle>
        <StatusRegion name="Story status" message={message} />
      </div>
      <section className="panel story-editor-panel">
        <div role="toolbar" aria-label="Formatting" className="toolbar format-toolbar">
          {TOOLS.map(([label, command, value]) => (
            <button key={label} type="button" className="btn btn-quiet" onMouseDown={(e) => e.preventDefault()} onClick={() => tool(command, value)}>
              {label}
            </button>
          ))}
          <button
            type="button"
            ref={linkButton}
            className="btn btn-quiet"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              remember();
              setDialog("link");
            }}
          >
            Link
          </button>
        </div>
        <div
          ref={editor}
          role="textbox"
          aria-multiline="true"
          aria-label="Story"
          contentEditable
          suppressContentEditableWarning
          className="story-editor story"
          onInput={keep}
          onKeyUp={remember}
          onMouseUp={remember}
          onBlur={remember}
        />
        <div className="toolbar sticky-bar phone-only-sticky" data-sticky-bar>
          <Button variant="primary" pending={busy === "save"} pendingText="Saving story…" onClick={() => void save()}>
            Save story
          </Button>
          <Button buttonRef={publishButton} pending={busy === "publish"} pendingText="Publishing…" onClick={() => setDialog("publish")}>
            Publish story
          </Button>
        </div>
        <p className="muted">Stories keep paragraphs, headings, bold, italic, lists and http, https or mailto links; anything else is removed on save.</p>
      </section>
      {dialog === "link" ? (
        <Dialog
          title="Add link"
          onClose={() => {
            setDialog("");
            focusLater(() => linkButton.current);
          }}
        >
          <form onSubmit={addLink} noValidate className="stack">
            <Field id="link-address" label="Link address" value={address} onChange={setAddress} hint="http, https or mailto" />
            <div className="dialog-actions">
              <Button type="submit" variant="primary">
                Add link
              </Button>
              <Button
                onClick={() => {
                  setDialog("");
                  focusLater(() => linkButton.current);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
      {dialog === "publish" ? (
        <Dialog
          title="Publish story"
          onClose={() => {
            setDialog("");
            focusLater(() => publishButton.current);
          }}
        >
          <p>The saved story goes on the public drop page and in every press preview.</p>
          <div className="dialog-actions">
            <Button variant="primary" pending={busy === "publish"} pendingText="Publishing…" onClick={() => void publish()}>
              Publish
            </Button>
            <Button
              onClick={() => {
                setDialog("");
                focusLater(() => publishButton.current);
              }}
            >
              Cancel
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
