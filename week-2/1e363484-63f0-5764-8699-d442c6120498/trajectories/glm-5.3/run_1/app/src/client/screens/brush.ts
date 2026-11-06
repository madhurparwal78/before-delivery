/**
 * The timeline brush. One place owns brush movement, resizing, stepping and
 * clamping. Half-hour units; the span stays between one half-hour and the
 * whole window, and start stays before end.
 */

import { el, clear } from '../ui.js'
import { fromHalfHourIndex, displayInterval, reducedMotion } from '../format.js'

export type BrushState = { startIdx: number; endIdx: number }

export type BrushCallbacks = {
  onPreview: () => void
  onSettle: () => void
}

export class Brush {
  private track: HTMLDivElement
  private listEl: HTMLOListElement
  private startSlider: HTMLDivElement
  private posSlider: HTMLDivElement
  private endSlider: HTMLDivElement
  private prevButton: HTMLButtonElement
  private nextButton: HTMLButtonElement
  private windowStart = 0
  private windowEnd = 0
  private recordStart = 0
  private recordEnd = 0
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private previewTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private parent: HTMLElement,
    private onChange: (state: BrushState) => void,
    private cb: BrushCallbacks,
  ) {
    this.listEl = el('ol', { class: 'timeline', 'aria-label': 'Daily net CO2e' }) as HTMLOListElement
    const zero = el('div', { class: 'zero-rule', role: 'separator', 'aria-label': 'Zero rule' })
    this.track = el('div', { class: 'brush-track' }) as HTMLDivElement

    this.startSlider = this.makeSlider('Interval start', () => this.state.startIdx,
      (v) => this.setEnd('start', v))
    this.posSlider = this.makeSlider('Interval position', () => this.state.startIdx,
      (v) => this.moveStart(v))
    this.endSlider = this.makeSlider('Interval end', () => this.state.endIdx,
      (v) => this.setEnd('end', v))

    this.prevButton = el('button', { text: 'Previous interval', onclick: () => this.shift(-1) }) as HTMLButtonElement
    this.nextButton = el('button', { text: 'Next interval', onclick: () => this.shift(1) }) as HTMLButtonElement

    const sliderRow = el('div', { class: 'slider-row' })
    sliderRow.append(
      this.startSlider, this.posSlider, this.endSlider, this.prevButton, this.nextButton,
    )

    parent.append(this.listEl, zero, this.track, sliderRow)

    this.bindDrag()
  }

  private state: BrushState = { startIdx: 0, endIdx: 0 }

  setBounds(recordStart: number, recordEnd: number): void {
    this.recordStart = recordStart
    this.recordEnd = recordEnd
  }

  setWindow(winStart: number, winEnd: number, resetBrush: boolean): void {
    this.windowStart = Math.max(winStart, this.recordStart)
    this.windowEnd = Math.min(winEnd, this.recordEnd)
    if (resetBrush) {
      this.state = { startIdx: this.windowStart, endIdx: this.windowEnd }
      this.apply()
    }
    this.updateSliders()
  }

  setBrush(startIdx: number, endIdx: number): void {
    this.state = { startIdx, endIdx }
    this.apply()
  }

  get value(): BrushState {
    return { ...this.state }
  }

  get window(): { start: number; end: number } {
    return { start: this.windowStart, end: this.windowEnd }
  }

  private makeSlider(name: string, getVal: () => number, setVal: (v: number) => void): HTMLDivElement {
    const s = el('div', {
      role: 'slider', tabindex: '0', 'aria-label': name,
      'aria-orientation': 'horizontal',
    }) as HTMLDivElement
    const update = (): void => {
      s.setAttribute('aria-valuemin', String(this.windowStart))
      s.setAttribute('aria-valuemax', String(this.windowEnd))
      s.setAttribute('aria-valuenow', String(getVal()))
      if (name === 'Interval position') {
        s.setAttribute('aria-valuetext', `${displayInterval(fromHalfHourIndex(this.state.startIdx))} to ${displayInterval(fromHalfHourIndex(this.state.endIdx))}`)
      } else if (name === 'Interval start') {
        s.setAttribute('aria-valuetext', displayInterval(fromHalfHourIndex(this.state.startIdx)))
      } else {
        s.setAttribute('aria-valuetext', displayInterval(fromHalfHourIndex(this.state.endIdx)))
      }
    }
    const keyboard = (e: KeyboardEvent): void => {
      let handled = true
      const dir = name === 'Interval end' ? 1 : -1
      switch (e.key) {
        case 'ArrowLeft': case 'ArrowDown':
          setVal(getVal() - 1); break
        case 'ArrowRight': case 'ArrowUp':
          setVal(getVal() + 1); break
        case 'PageDown':
          setVal(getVal() - 48); break
        case 'PageUp':
          setVal(getVal() + 48); break
        case 'Home':
          setVal(this.windowStart); break
        case 'End':
          setVal(this.windowEnd); break
        default:
          handled = false
      }
      if (handled) {
        e.preventDefault()
        this.updateSliderAttrs()
      }
    }
    s.addEventListener('keydown', keyboard)
    ;(s as HTMLDivElement & { __update: () => void }).__update = update
    return s
  }

  private updateSliderAttrs(): void {
    for (const s of [this.startSlider, this.posSlider, this.endSlider]) {
      ;(s as HTMLDivElement & { __update: () => void }).__update()
    }
    this.updateSliders()
  }

  private updateSliders(): void {
    this.updateSliderAttrsLight()
  }

  private updateSliderAttrsLight(): void {
    for (const s of [this.startSlider, this.posSlider, this.endSlider]) {
      ;(s as HTMLDivElement & { __update: () => void }).__update()
    }
    this.drawTrack()
  }

  // ---- movement ----

  private clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v))
  }

  private setEnd(which: 'start' | 'end', v: number): void {
    if (which === 'start') {
      const start = this.clamp(v, this.windowStart, this.state.endIdx - 1)
      this.state = { startIdx: start, endIdx: this.state.endIdx }
    } else {
      const end = this.clamp(v, this.state.startIdx + 1, this.windowEnd)
      this.state = { startIdx: this.state.startIdx, endIdx: end }
    }
    this.apply()
  }

  private moveStart(newStart: number): void {
    const span = this.state.endIdx - this.state.startIdx
    let start = this.clamp(newStart, this.windowStart, this.windowEnd - span)
    let end = start + span
    if (end > this.windowEnd) {
      end = this.windowEnd
      start = end - span
      if (start < this.windowStart) start = this.windowStart
    }
    this.state = { startIdx: start, endIdx: end }
    this.apply()
  }

  private shift(dir: 1 | -1): void {
    const span = this.state.endIdx - this.state.startIdx
    const target = this.state.startIdx + dir * span
    this.moveStart(target)
  }

  private apply(): void {
    this.onChange(this.state)
    this.updateSliderAttrsLight()
    this.schedulePreview()
  }

  /** Throttle previews while changing; a trailing request fires on settle. */
  private schedulePreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer)
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null
      this.cb.onPreview()
    }, 250)
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.cb.onSettle()
    }, 500)
  }

  /** Whether the brush has not changed for the settle delay. */
  isSettled(): boolean {
    return this.settleTimer === null
  }

  private drawTrack(): void {
    const range = Math.max(1, this.windowEnd - this.windowStart)
    const pct = (idx: number): string => `${((idx - this.windowStart) / range) * 100}%`
    const body = this.track.querySelector('.brush-body') as HTMLElement | null
    const left = this.track.querySelector('.brush-handle-left') as HTMLElement | null
    const right = this.track.querySelector('.brush-handle-right') as HTMLElement | null
    if (body) {
      body.style.left = pct(this.state.startIdx)
      body.style.width = `${((this.state.endIdx - this.state.startIdx) / range) * 100}%`
    }
    if (left) left.style.left = `calc(${pct(this.state.startIdx)} - 9px)`
    if (right) right.style.left = `calc(${pct(this.state.endIdx)} - 9px)`
  }

  private bindDrag(): void {
    const body = el('div', { class: 'brush-body', 'aria-hidden': 'true' })
    const left = el('div', { class: 'brush-handle brush-handle-left', 'aria-hidden': 'true' })
    const right = el('div', { class: 'brush-handle brush-handle-right', 'aria-hidden': 'true' })
    this.track.append(body, left, right)

    type Mode = 'body' | 'start' | 'end' | null
    let mode: Mode = null
    let grabOffset = 0

    const idxFromEvent = (e: PointerEvent): number => {
      const rect = this.track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const range = Math.max(1, this.windowEnd - this.windowStart)
      return Math.round(this.windowStart + ratio * range)
    }

    this.track.addEventListener('pointerdown', (e) => {
      if (e.target === body) {
        mode = 'body'
        grabOffset = idxFromEvent(e) - this.state.startIdx
      } else if (e.target === left) {
        mode = 'start'
      } else if (e.target === right) {
        mode = 'end'
      } else {
        return
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId)
      e.preventDefault()
    })
    this.track.addEventListener('pointermove', (e) => {
      if (!mode) return
      const idx = idxFromEvent(e)
      if (mode === 'body') this.moveStart(idx - grabOffset)
      else this.setEnd(mode, idx)
    })
    const stop = (): void => { mode = null }
    this.track.addEventListener('pointerup', stop)
    this.track.addEventListener('pointercancel', stop)
    this.track.addEventListener('lostpointercapture', stop)
  }

  /** Draw the day bars for the timeline list. */
  renderDays(days: { date: string; net_tco2e: string; coverage_pct: string }[]): void {
    clear(this.listEl)
    let maxAbs = 0.0001
    for (const d of days) maxAbs = Math.max(maxAbs, Math.abs(Number(d.net_tco2e)))
    for (const d of days) {
      const signed = d.net_tco2e.startsWith('-') ? d.net_tco2e
        : Number(d.net_tco2e) === 0 ? d.net_tco2e : `+${d.net_tco2e}`
      const li = el('li')
      li.setAttribute('aria-label', `${d.date} ${signed} tCO2e`)
      const height = Math.max(4, Math.round((Math.abs(Number(d.net_tco2e)) / maxAbs) * 80))
      const v = Number(d.net_tco2e)
      let cls = 'bar '
      let cellCls = 'cell '
      if (v < 0) { cls += 'uptake'; cellCls += 'lower' }
      else if (v > 0) { cls += 'emission' }
      else { cls += 'zero'; cellCls += 'lower' }
      const bar = el('div', { class: cls })
      bar.style.height = `${v === 0 ? 2 : height}px`
      const cell = el('div', { class: cellCls, 'aria-hidden': 'true' })
      cell.append(bar)
      li.append(cell)
      this.listEl.append(li)
    }
  }
}
