import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { COLOR_NAMES, type ColorName } from '../../shared/domain.ts'
import { wrapTab } from '../ui/Dialog.tsx'

interface ColourMenuProps {
  current: ColorName | null
  onChoose: (color: ColorName) => void
  onClose: () => void
}

const LABEL = (color: ColorName): string => color.charAt(0).toUpperCase() + color.slice(1)

/** `menu "Entity colour"`: arrows move, Enter or Space chooses, Escape closes, a click outside closes. */
export function ColourMenu({ current, onChoose, onClose }: ColourMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)

  // The toolbar scrolls sideways and would clip a menu inside it, so the menu is placed under its chip on the page.
  useLayoutEffect(() => {
    const chip = document.querySelector('.chip-anchor > button')?.getBoundingClientRect()
    if (chip) setPlace({ top: chip.bottom + 6, left: Math.min(chip.left, window.innerWidth - 184) })
  }, [])

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent): void => {
      if (menu.current && !menu.current.contains(event.target as Node) && !(event.target as Element).closest('.chip-anchor')) close.current()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])

  const keyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus()
    else if (event.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus()
    else if (event.key === 'Escape') onClose()
    else {
      wrapTab(event, event.currentTarget)
      return
    }
    event.preventDefault()
  }

  return (
    <div ref={menu} role="menu" aria-label="Entity colour" className="menu colour-menu" style={place ?? undefined} onKeyDown={keyDown}>
      {COLOR_NAMES.map((color) => (
        <button key={color} type="button" role="menuitemradio" aria-checked={current === color} className="colour-item" onClick={() => onChoose(color)}>
          <span className="swatch" data-color={color} aria-hidden="true" />
          {LABEL(color)}
        </button>
      ))}
    </div>
  )
}
