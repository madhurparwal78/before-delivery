import './styles/tokens.css'
import './styles/base.css'
import { startRouter } from './lib/router'
import { registerRoutes } from './routes'

/** From 768 px the joystick, Run and Jump show only on a touch device: a coarse primary pointer on a multi-touch screen,
 *  which the two-finger orbit and pinch need. */
const coarse = matchMedia('(pointer: coarse)')
const markTouch = (): void => {
  document.documentElement.classList.toggle('touch-device', coarse.matches && navigator.maxTouchPoints >= 2)
}
markTouch()
coarse.addEventListener('change', markTouch)

/** The face is on hand before the first page is built, so no line is set in a fallback and then reflowed when it arrives. */
async function faceReady(): Promise<void> {
  const loading = document.fonts.load('400 1em "Albert Sans"').then(() => undefined, () => undefined)
  await Promise.race([loading, new Promise<void>((resolve) => setTimeout(resolve, 1500))])
}

registerRoutes()
void faceReady().then(() => startRouter(document.getElementById('app') as HTMLElement))
