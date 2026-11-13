let show: () => void = () => undefined

/** Registers the function that renders the screen for the current location. */
export function onNavigate(render: () => void): void {
  show = render
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  show()
}
