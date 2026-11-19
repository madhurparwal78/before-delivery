import { Heart, Lightbulb, Sparkles, HandHeart, SmilePlus } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, GENERIC_ERROR } from "../lib/api";
import { showAlert } from "../lib/feedback";
import type { Pin, ReactionType } from "../../shared/types";

const CHOICES: { type: ReactionType; label: string; icon: ReactNode }[] = [
  { type: "love", label: "Love", icon: <Heart size={20} aria-hidden="true" /> },
  { type: "idea", label: "Idea", icon: <Lightbulb size={20} aria-hidden="true" /> },
  { type: "wow", label: "Wow", icon: <Sparkles size={20} aria-hidden="true" /> },
  { type: "thanks", label: "Thanks", icon: <HandHeart size={20} aria-hidden="true" /> },
];

/** `button "React"` opens `menu "Reactions"`; each person keeps at most one of the four. */
export function ReactMenu({ pin, onChange }: { pin: Pin; onChange: (mine: ReactionType | null, reactions: number) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const checked = items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0];
    checked?.focus();
    const away = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  const choose = async (type: ReactionType): Promise<void> => {
    close();
    try {
      const result = await api.put<{ mine: ReactionType | null; reactions: number }>(`/api/pins/${pin.id}/reaction`, { type });
      onChange(result.mine, result.reactions);
    } catch {
      showAlert(GENERIC_ERROR);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? -1 : 1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className="react">
      <button ref={button} type="button" className="button button--quiet" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <SmilePlus size={20} aria-hidden="true" />
        React
      </button>
      {open ? (
        <div ref={menu} role="menu" aria-label="Reactions" className="menu" onKeyDown={onKeyDown}>
          {CHOICES.map((choice) => (
            <button
              key={choice.type}
              type="button"
              role="menuitemradio"
              aria-checked={pin.my_reaction === choice.type}
              tabIndex={-1}
              className="menu-item"
              onClick={() => void choose(choice.type)}
            >
              {choice.icon}
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
