import { h } from '../dom.ts'

interface MenuItem {
  label: string
  disabled: boolean
}

export interface OpenMenu {
  close(focusTrigger: boolean): void
}

/** A `role="menu"` below its button: Arrow keys wrap, Home and End jump, Enter or Space picks, Escape and Tab close. */
export function openMenu(trigger: HTMLElement, label: string, items: readonly MenuItem[], onPick: (item: string) => void): OpenMenu {
  const buttons = items.map((item) => h('button', { type: 'button', role: 'menuitem', tabindex: '-1', 'aria-disabled': item.disabled ? 'true' : null, class: 'menu-item' }, item.label))
  const menu = h('div', { role: 'menu', 'aria-label': label, class: 'menu' }, ...buttons)
  let closed = false
  const close = (focusTrigger: boolean): void => {
    if (closed) return
    closed = true
    document.removeEventListener('pointerdown', outside, true)
    menu.remove()
    trigger.setAttribute('aria-expanded', 'false')
    if (focusTrigger) trigger.focus()
  }
  const outside = (event: Event): void => {
    if (!menu.contains(event.target as Node) && event.target !== trigger) close(false)
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return
      close(false)
      onPick(items[index].label)
    })
  })
  menu.addEventListener('keydown', (event) => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const move = (to: number): void => {
      event.preventDefault()
      buttons[(to + buttons.length) % buttons.length].focus()
    }
    if (event.key === 'ArrowDown') move(at + 1)
    else if (event.key === 'ArrowUp') move(at - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(buttons.length - 1)
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      buttons[at]?.click()
    }
  })
  trigger.setAttribute('aria-expanded', 'true')
  trigger.after(menu)
  document.addEventListener('pointerdown', outside, true)
  buttons[0].focus()
  return { close }
}
