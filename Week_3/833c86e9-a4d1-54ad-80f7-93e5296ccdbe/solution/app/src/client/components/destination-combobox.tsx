import { forwardRef, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { DestinationRow } from '../../shared/types'
import { get, query } from '../api'
import { useApp } from '../state'

/** The Destination combobox: typing lists matching destinations after the debounce, arrows move the active option, Enter picks. */
export const DestinationCombobox = forwardRef<HTMLInputElement, { text: string; onText: (text: string) => void; onPick: (destination: DestinationRow) => void }>(
  function DestinationCombobox({ text, onText, onPick }, ref) {
    const app = useApp()
    const id = useId()
    const listId = `${id}-list`
    const [options, setOptions] = useState<DestinationRow[]>([])
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(-1)
    const [busy, setBusy] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
    const sequence = useRef(0)

    useEffect(() => () => clearTimeout(timer.current), [])

    const lookup = async (typed: string): Promise<void> => {
      const mine = ++sequence.current
      setBusy(true)
      try {
        const found = await get<DestinationRow[]>(`/api/destinations?${query({ q: typed.trim() })}`)
        if (mine !== sequence.current) return
        setOptions(found)
        setOpen(found.length > 0)
        setActive(-1)
      } finally {
        if (mine === sequence.current) setBusy(false)
      }
    }

    const close = (): void => {
      sequence.current += 1
      clearTimeout(timer.current)
      setBusy(false)
      setOpen(false)
      setActive(-1)
    }

    const pick = (destination: DestinationRow): void => {
      close()
      onPick(destination)
    }

    const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!open) return void lookup(text)
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((at) => (at + step + options.length) % options.length)
      } else if (event.key === 'Enter' && open && active >= 0) {
        event.preventDefault()
        pick(options[active])
      } else if (event.key === 'Escape') {
        if (open) {
          event.preventDefault()
          event.stopPropagation()
          close()
        } else if (text !== '') {
          event.preventDefault()
          onText('')
        }
      }
    }

    return (
      <div className="combo">
        <input
          ref={ref} id={id} className="field" role="combobox" type="text" autoComplete="off" spellCheck={false} value={text} data-focus-key="destination"
          aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-busy={busy ? 'true' : undefined}
          aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
          aria-label={app.t('ui.destination')}
          onChange={(event) => {
            onText(event.target.value)
            clearTimeout(timer.current)
            const typed = event.target.value
            timer.current = setTimeout(() => void lookup(typed), window.__KIP__.typeDebounceMs)
          }}
          onKeyDown={onKey}
          onBlur={close}
        />
        {open && (
          <ul id={listId} role="listbox" aria-label={app.t('ui.destination')} className="combo-list">
            {options.map((option, index) => (
              <li
                key={option.code} id={`${id}-option-${index}`} role="option" aria-selected={index === active} className="combo-option"
                onMouseDown={(event) => event.preventDefault()} onClick={() => pick(option)}
              >
                {app.t('ui.destinationOption', { name: option.name, 'count:property': option.property_count })}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  },
)
