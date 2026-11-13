import { useLayoutEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react'
import { useApp } from '../state'
import { Button, Dialog, prefersReducedMotion } from '../ui'

const SWIPE_PX = 60

interface Slide { from: number; to: number; step: 1 | -1 }

/** `button "Show pictures"` and the `dialog "Pictures"` it opens. */
export function Gallery({ pictures }: { pictures: string[] }) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button className="quiet" onClick={() => setOpen(true)}>{app.t('ui.showPictures')}</Button>
      {open && <Pictures pictures={pictures} onClose={() => setOpen(false)} />}
    </>
  )
}

function Pictures({ pictures, onClose }: { pictures: string[]; onClose: () => void }) {
  const app = useApp()
  const [index, setIndex] = useState(0)
  const [slide, setSlide] = useState<Slide | null>(null)
  const [drag, setDrag] = useState(0)
  const [unavailable, setUnavailable] = useState(false)
  const touch = useRef<{ start: number; last: number } | null>(null)
  const elements = useRef(new Map<number, HTMLElement>())
  const rtl = app.dir === 'rtl'

  /* One picture toward the next (+1) or previous (-1) in reading order; the pair slides unless motion is reduced. */
  const go = (step: 1 | -1): void => {
    const to = (index + step + pictures.length) % pictures.length
    setSlide(prefersReducedMotion() ? null : { from: index, to, step })
    setIndex(to)
  }

  useLayoutEffect(() => {
    if (!slide) return
    const visual = rtl ? -slide.step : slide.step
    const move = (element: HTMLElement | undefined, from: number, to: number): Animation | undefined => {
      const animation = element?.animate([{ transform: `translateX(${from}%)` }, { transform: `translateX(${to}%)` }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' })
      if (animation) animation.id = 'gallery-slide'
      return animation
    }
    move(elements.current.get(slide.from), 0, -visual * 100)
    const incoming = move(elements.current.get(slide.to), visual * 100, 0)
    if (incoming) incoming.onfinish = () => setSlide((current) => (current === slide ? null : current))
  }, [slide, rtl])

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    go((event.key === 'ArrowRight') !== rtl ? 1 : -1)
  }

  const onTouchMove = (event: TouchEvent): void => {
    if (!touch.current) return
    touch.current.last = event.touches[0].clientX
    setDrag(touch.current.last - touch.current.start)
  }

  const onTouchEnd = (): void => {
    const moved = touch.current ? touch.current.last - touch.current.start : 0
    touch.current = null
    setDrag(0)
    if (Math.abs(moved) >= SWIPE_PX) go((moved < 0) !== rtl ? 1 : -1)
  }

  const shown = slide ? [slide.from, slide.to] : [index]

  return (
    <Dialog label={app.t('ui.pictures')} onClose={onClose} dataIndex={index + 1} className="dialog-gallery">
      <div onKeyDown={onKey} className="gallery">
        {unavailable ? (
          <p className="gallery-unavailable">{app.t('storage.pictures')}</p>
        ) : (
          <div
            className="gallery-frame" style={{ transform: drag ? `translateX(${drag}px)` : undefined }}
            onTouchStart={(event) => void (touch.current = { start: event.touches[0].clientX, last: event.touches[0].clientX })}
            onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { touch.current = null; setDrag(0) }}
          >
            {shown.map((i) => (
              <div key={i} ref={(element) => void (element ? elements.current.set(i, element) : elements.current.delete(i))} className="slide">
                <img src={pictures[i]} alt={app.t('ui.pictureOf', { i: i + 1, n: pictures.length })} draggable={false} onError={() => setUnavailable(true)} />
              </div>
            ))}
          </div>
        )}
        <p className="muted gallery-caption" aria-hidden="true">{app.t('ui.pictureOf', { i: index + 1, n: pictures.length })}</p>
        <div className="gallery-buttons">
          <Button className="quiet" onClick={() => go(-1)}>{app.t('ui.prevPicture')}</Button>
          <Button className="quiet" onClick={() => go(1)}>{app.t('ui.nextPicture')}</Button>
          <Button onClick={onClose}>{app.t('ui.close')}</Button>
        </div>
      </div>
    </Dialog>
  )
}
