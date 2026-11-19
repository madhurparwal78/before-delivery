import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { Icon } from './Icon.tsx';

export interface AccordionItem {
  id: string;
  title: ComponentChildren;
  body: ComponentChildren;
}

interface AccordionProps {
  items: AccordionItem[];
  /** Open one row at a time. */
  exclusive?: boolean;
  /** Row ids open at the start. */
  initialOpen?: string[];
  /** `rows`: lavender rows that open into a white card. `plain`: hairline dividers. */
  variant?: 'rows' | 'plain';
  /** Heading level wrapped around each row button. */
  headingLevel?: 2 | 3 | 4;
  class?: string;
  onToggle?: (id: string, open: boolean) => void;
}

/**
 * Rows that open and close over 200ms (grid-template-rows 0fr to 1fr). A closed row is hidden outright:
 * `inert` plus `visibility: hidden` take its content out of view, focus order and the accessibility tree.
 */
export function Accordion({ items, exclusive = false, initialOpen = [], variant = 'rows', headingLevel = 3, class: className, onToggle }: AccordionProps) {
  const base = useId();
  const [open, setOpen] = useState<string[]>(initialOpen);

  const toggle = (id: string): void => {
    const isOpen = open.includes(id);
    setOpen(isOpen ? open.filter((o) => o !== id) : exclusive ? [id] : [...open, id]);
    onToggle?.(id, !isOpen);
  };

  const Heading = `h${headingLevel}` as 'h3';
  return (
    <div class={`acc acc-${variant}${className ? ` ${className}` : ''}`}>
      {items.map((item) => {
        const isOpen = open.includes(item.id);
        const buttonId = `${base}-b-${item.id}`;
        const panelId = `${base}-p-${item.id}`;
        return (
          <div class="acc-item" data-open={isOpen ? 'true' : 'false'} key={item.id}>
            <Heading class="acc-h">
              <button type="button" class="acc-btn" id={buttonId} aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(item.id)}>
                <span>{item.title}</span>
                <Icon name="chevron-down" size={20} />
              </button>
            </Heading>
            <div class="acc-panel" id={panelId} role="group" aria-labelledby={buttonId} data-open={isOpen ? 'true' : 'false'} inert={!isOpen}>
              <div class="acc-inner">
                <div class="acc-body">{item.body}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
