import type { Settings, GameJson, PlayerJson, PuzzleJson, ServerMessage, Square, WriteMessage, ClientWrite } from '../../shared/types.ts'
import { formatTime, revealedPhrase } from '../../shared/format.ts'

import { ApiFailure, api, config, download, saveBlob } from '../api.ts'
import { h, icon } from '../dom.ts'
import { ensurePlayer } from '../session.ts'
import { ClueLists } from '../room/clues.ts'
import { advance, arrowSteps, clueAfter, landing, startPosition, stepAlong } from '../room/cursor.ts'
import { openClearConfirm, openRaceOver, openSettings, openShare, openSolved } from '../room/dialogs.ts'
import { GridView } from '../room/grid.ts'
import { Live } from '../room/live.ts'
import { type OpenMenu, openMenu } from '../room/menus.ts'
import { type Position, PuzzleModel, type Clue, opposite } from '../room/model.ts'
import { SquareStore, emptySquare } from '../room/store.ts'
import { isLocked, marked } from '../../shared/squares.ts'
import { REBUS_MAX } from '../../shared/limits.ts'
import { SOMETHING_WRONG, STORAGE_DOWN } from '../../shared/copy.ts'
import { directionName } from '../../shared/numbering.ts'
import { loadingTiles, messageTile } from '../view.ts'
import type { View } from '../view.ts'

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

export async function renderRoom(view: View): Promise<void> {
  const { main, params } = view
  loadingTiles(main, ['c12 r1', 'c6 r1', 'c6 r8', 'c3 r8', 'c3 r8'])
  const me = await ensurePlayer()
  try {
    const game = await api<GameJson>('GET', `/api/games/${params[0]}`)
    const [puzzle, settings, cfg] = await Promise.all([api<PuzzleJson>('GET', `/api/puzzles/${game.puzzle_id}`), api<Settings>('GET', '/api/players/me/settings'), config()])
    if (!view.current()) return
    main.removeAttribute('aria-busy')
    const room = new Room(view, me.id, game, puzzle, settings, cfg.toast_ms)
    view.onLeave(() => room.leave())
    room.mount()
  } catch (failure) {
    if (!view.current()) return
    main.removeAttribute('aria-busy')
    if (failure instanceof ApiFailure) messageTile(main, failure.message)
    else throw failure
  }
}

type Cursor = { row: number; col: number; colour: PlayerJson['colour']; order: number }

class Room {
  private readonly model: PuzzleModel
  private readonly store = new SquareStore()
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  private readonly grid: GridView
  private readonly clueLists: ClueLists
  private position: Position = { row: 0, col: 0, direction: 'across' }
  private pencil = false
  private dead = false
  private readonly cursors = new Map<string, Cursor>()
  private timer: { state: GameJson['timer_state']; base: number; at: number }
  private frozen: string | null = null
  private noticeTimer: ReturnType<typeof setTimeout> | undefined
  private tick: ReturnType<typeof setInterval> | undefined
  private live: Live | null = null
  private menu: OpenMenu | null = null
  private editor: HTMLInputElement | null = null
  private lastClue = ''

  private readonly clueText = h('p', { class: 'clue-text' })
  private readonly announcements = h('div', { role: 'status', 'aria-label': 'Grid announcements', 'aria-live': 'polite', class: 'sr-only' })
  private readonly notices = h('p', { role: 'status', 'aria-label': 'Game notices', 'aria-live': 'polite', class: 'notice' })
  private readonly timerEl = h('div', { role: 'timer', 'aria-label': 'Solve time', class: 'timer' })
  private readonly players = h('ul', { class: 'players', 'aria-label': 'Players' })
  private readonly pauseButton = h('button', { type: 'button', class: 'pause-tool', 'aria-pressed': 'false' }, icon('pause'), h('span', null, 'Pause my timer'))
  private readonly pencilButtons: HTMLButtonElement[] = []
  private readonly teamScores = h('p', { role: 'status', 'aria-label': 'Team scores', class: 'team-scores' })
  private startRace: HTMLButtonElement | null = null
  private teamRadios: HTMLInputElement[] = []
  private readonly onDocumentKey = (event: KeyboardEvent): void => this.shortcut(event)

  constructor(private readonly view: View, private readonly me: string, private game: GameJson, puzzle: PuzzleJson, private settings: Settings, private readonly toastMs: number) {
    this.model = new PuzzleModel(puzzle)
    this.grid = new GridView(this.model, this.reducedMotion)
    this.clueLists = new ClueLists(this.model, (clue) => this.select(landing(this.model, clue, (r, c) => this.filled(r, c))), this.reducedMotion)
    this.store.reset(game.squares)
    this.timer = { state: game.timer_state, base: game.elapsed_ms, at: performance.now() }
    this.timerEl.dataset.timerState = game.timer_state
  }

  private get race(): boolean {
    return this.game.mode === 'race'
  }

  private get myPlayer(): PlayerJson {
    const mine = this.game.players.find((player) => player.id === this.me)
    if (!mine) throw new Error('The viewer is not a player of this game')
    return mine
  }

  private get watching(): boolean {
    return this.race && this.myPlayer.team === null
  }

  private get colourOf(): PlayerJson['colour'] {
    return this.myPlayer.colour
  }

  private filled(row: number, col: number): boolean {
    return this.store.get(row, col).value !== ''
  }

  // --- building -------------------------------------------------------------

  mount(): void {
    const { main } = this.view
    main.classList.add('room', ...(this.race ? ['race'] : []))
    main.dataset.colour = this.colourOf
    this.view.onLeave(() => main.classList.remove('room', 'race'))
    const roomBar = h('section', { class: 'tile room-bar' }, h('h1', null, this.game.puzzle_title), this.timerEl, this.announcements)
    const clueBar = h(
      'section',
      { class: 'tile clue-bar', 'aria-label': 'Current clue' },
      h('button', { type: 'button', class: 'clue-step', 'aria-label': 'Previous clue', onclick: () => this.stepClue(-1) }, icon('previous')),
      this.clueText,
      h('button', { type: 'button', class: 'clue-step', 'aria-label': 'Next clue', onclick: () => this.stepClue(1) }, icon('next')),
    )
    main.replaceChildren(roomBar, clueBar, this.grid.tile, this.clueLists.acrossTile, this.clueLists.downTile, this.keyboard(), this.tools(), ...(this.race ? [this.raceTile()] : []), this.players)
    this.view.band(null)
    this.bindGrid()
    document.addEventListener('keydown', this.onDocumentKey)
    this.paintSquares()
    this.position = startPosition(this.model, (r, c) => this.filled(r, c))
    this.grid.setDirection(this.position.direction)
    this.paintSquares()
    this.paintSelection(null, true)
    this.paintPlayers()
    this.paintTimer()
    this.paintStatus()
    this.tick = setInterval(() => this.paintTimer(), 1000)
    this.live = new Live(this.game.id, {
      onMessage: (message) => this.receive(message),
      onUp: () => this.view.band(null),
      onDown: () => this.view.band('Connection lost. Reconnecting.'),
    })
    this.grid.element.focus()
  }

  leave(): void {
    clearInterval(this.tick)
    clearTimeout(this.noticeTimer)
    document.removeEventListener('keydown', this.onDocumentKey)
    this.live?.close()
    document.body.removeAttribute('data-solved')
  }

  private tools(): HTMLElement {
    const check = this.menuButton('Check', 'check')
    const reveal = this.menuButton('Reveal', 'check')
    const clear = this.menuButton('Clear', 'clear')
    if (this.race) reveal.disabled = true
    this.pauseButton.addEventListener('click', () => {
      const pressed = this.pauseButton.getAttribute('aria-pressed') !== 'true'
      this.pauseButton.setAttribute('aria-pressed', String(pressed))
      this.frozen = pressed ? this.timerEl.textContent : null
      this.paintTimer()
    })
    const pencil = h('button', { type: 'button', class: 'pencil-tool', 'aria-pressed': 'false', onclick: () => this.togglePencil() }, icon('pencil'), h('span', null, 'Pencil'))
    this.pencilButtons.push(pencil)
    const rebus = h('button', { type: 'button', class: 'rebus-tool', onclick: () => this.openEditor() }, icon('rebus'), h('span', null, 'Rebus'))
    const share = h('button', { type: 'button', onclick: () => openShare(() => this.game, this.me === this.game.host_player_id, (next) => void (this.game = { ...this.game, code: next.code, link_state: next.link_state })) }, icon('share'), h('span', null, 'Share'))
    const settings = h('button', { type: 'button', onclick: () => openSettings(() => this.settings, (next) => this.saveSettings(next)) }, icon('settings'), h('span', null, 'Settings'))
    const original = this.model.puzzle.source === 'upload' ? h('button', { type: 'button', onclick: () => this.downloadOriginal() }, icon('download'), h('span', null, 'Download original')) : null
    return h('section', { class: 'tile tools' }, this.notices, h('div', { class: 'tool-buttons' }, this.pauseButton, pencil, rebus, check, reveal, clear, settings, share, original))
  }

  private menuButton(name: 'Check' | 'Reveal' | 'Clear', glyph: 'check' | 'clear'): HTMLButtonElement {
    return h('button', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu': name, onclick: () => this.openMenuFor(name) }, icon(glyph), h('span', null, name))
  }

  private keyboard(): HTMLElement {
    const key = (label: string, content: string | SVGElement, extra: Record<string, string> = {}): HTMLButtonElement =>
      h('button', { type: 'button', class: 'key', 'aria-label': label.length === 1 ? null : label, onpointerdown: (event: PointerEvent) => event.preventDefault(), onclick: () => this.pressKey(label), ...extra }, content)
    const pencil = h('button', { type: 'button', class: 'key wide', 'aria-pressed': 'false', onpointerdown: (event: PointerEvent) => event.preventDefault(), onclick: () => this.togglePencil() }, 'Pencil')
    this.pencilButtons.push(pencil)
    return h(
      'section',
      { class: 'tile keyboard', role: 'group', 'aria-label': 'Letter keyboard' },
      ...KEY_ROWS.map((letters, index) => h('div', { class: 'key-row' }, ...[...letters].map((letter) => key(letter, letter)), ...(index === 2 ? [key('Backspace', icon('backspace'))] : []))),
      h('div', { class: 'key-row' }, pencil, key('Rebus', 'Rebus', { class: 'key wide' }), key('Switch direction', icon('switch'), { class: 'key wide' })),
    )
  }

  private raceTile(): HTMLElement {
    const radios = ([1, 2, null] as const).map((team) => {
      const label = team === null ? 'Watch' : `Team ${team}`
      const input = h('input', { type: 'radio', name: 'team', value: label })
      input.addEventListener('change', () => void api('POST', `/api/games/${this.game.id}/team`, { team }).catch(() => undefined))
      this.teamRadios.push(input)
      return h('label', { class: 'chip-label' }, input, h('span', null, label))
    })
    const isHost = this.me === this.game.host_player_id
    if (isHost) {
      this.startRace = h('button', { type: 'button', onclick: () => void api('POST', `/api/games/${this.game.id}/race/start`, {}).catch(() => undefined) }, 'Start race')
    }
    return h('section', { class: 'tile race-tile' }, h('div', { role: 'radiogroup', 'aria-label': 'Team', class: 'radios' }, ...radios), this.teamScores, this.startRace)
  }

  // --- painting -------------------------------------------------------------

  private paintOne(square: Square): void {
    this.grid.paintSquare(square, this.position.direction)
    if (this.race && square.state === 'right') this.grid.markClaimed(square.row, square.col)
  }

  private paintSquares(): void {
    for (let row = 0; row < this.model.puzzle.rows; row++) for (let col = 0; col < this.model.puzzle.cols; col++) if (this.model.isWhite(row, col)) this.paintOne(this.store.get(row, col))
  }

  private activeClue(position: Position = this.position): Clue | undefined {
    return this.model.clueAt(position.direction, position.row, position.col)
  }

  private paintSelection(previous: Position | null, announce: boolean): void {
    const active = this.activeClue()
    const crossing = this.model.clueAt(opposite(this.position.direction), this.position.row, this.position.col)
    const linked = (active?.links ?? []).flatMap((ref) => this.model.clueOf(ref) ?? [])
    this.grid.setDirection(this.position.direction)
    this.grid.paintSelection(this.position, previous, active, linked)
    this.clueLists.paint(active, crossing, linked)
    if (active) this.clueText.textContent = `${active.number}${active.direction === 'across' ? 'A' : 'D'} ${active.text}`
    const id = active ? `${active.direction}:${active.number}` : ''
    if (active && id !== this.lastClue) {
      this.lastClue = id
      this.clueLists.scrollTo(active)
      if (announce) {
        const names = linked.map((clue) => `${clue.number} ${directionName(clue.direction)}`)
        const joined = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
        this.announce(`${active.number} ${directionName(active.direction)}: ${active.text}. ${active.length} letters.${names.length > 0 ? ` Linked to ${joined}.` : ''}`)
      }
    }
    if (this.editor) this.placeEditor()
  }

  private paintPlayers(): void {
    this.players.replaceChildren(
      ...this.game.players.map((player) =>
        h(
          'li',
          { class: 'tile player', 'data-colour': player.colour },
          h('strong', null, player.display_name),
          h('span', null, `${player.colour} · ${player.present ? 'Here' : 'Away'}${player.host ? ' · Host' : ''}`),
          this.race ? h('span', null, player.team === null ? 'Watching' : `Team ${player.team} · ${player.score}`) : null,
        ),
      ),
    )
    this.paintRace()
  }

  private paintRace(): void {
    if (!this.race) return
    const scores = this.game.scores ?? { 1: 0, 2: 0 }
    this.teamScores.textContent = `Team 1 ${scores[1]} · Team 2 ${scores[2]}`
    const lobby = this.game.race_state === 'lobby'
    const mine = this.myPlayer.team
    this.teamRadios.forEach((radio, index) => {
      radio.checked = (index === 2 ? null : index + 1) === mine
      radio.disabled = !lobby
    })
    if (this.startRace) this.startRace.disabled = !(lobby && [1, 2].every((team) => this.game.players.some((player) => player.team === team)))
  }

  private paintTimer(): void {
    this.timerEl.dataset.timerState = this.timer.state
    const shown = this.timer.state === 'running' ? this.timer.base + (performance.now() - this.timer.at) : this.timer.base
    if (this.frozen === null) this.timerEl.textContent = formatTime(shown)
  }

  private paintStatus(): void {
    for (const button of this.pencilButtons) button.setAttribute('aria-pressed', String(this.pencil))
    this.paintRace()
  }

  private announce(text: string): void {
    this.announcements.textContent = text
  }

  private notify(text: string): void {
    this.notices.textContent = text
    clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => (this.notices.textContent = ''), this.toastMs)
  }

  // --- selection ------------------------------------------------------------

  private select(next: Position, send = true): void {
    const previous = this.position
    const directionChanged = next.direction !== previous.direction
    const from = this.activeClue(previous)
    this.position = next
    if (directionChanged) {
      this.paintSquares()
      this.grid.pivot(from, this.activeClue(), next)
    }
    this.paintSelection(previous, true)
    if (send && this.live?.isOpen() && !this.watching) this.live.send({ type: 'cursor', row: next.row, col: next.col, direction: next.direction })
  }

  private switchDirection(): void {
    const other = opposite(this.position.direction)
    if (this.model.clueAt(other, this.position.row, this.position.col)) this.select({ ...this.position, direction: other })
  }

  private stepClue(step: 1 | -1): void {
    const active = this.activeClue()
    if (active) this.select(landing(this.model, clueAfter(this.model, active, step), (r, c) => this.filled(r, c)))
  }

  private linkedClue(): void {
    const active = this.activeClue()
    if (!active || active.links.length === 0) return
    const order = this.model.clues
    const at = order.indexOf(active)
    for (let step = 1; step < order.length; step++) {
      const candidate = order[(at + step) % order.length]
      if (active.links.some((ref) => ref.number === candidate.number && ref.direction === candidate.direction)) {
        this.select(landing(this.model, candidate, (r, c) => this.filled(r, c)))
        return
      }
    }
  }

  private clickSquare(row: number, col: number, touch: boolean): void {
    this.grid.element.focus()
    const here = this.position.row === row && this.position.col === col
    let direction = this.position.direction
    if (!this.model.clueAt(direction, row, col)) direction = opposite(direction)
    if (here && touch) {
      this.switchDirection()
      return
    }
    if (!here || direction !== this.position.direction) this.select({ row, col, direction })
  }

  private bindGrid(): void {
    const element = this.grid.element
    element.addEventListener('pointerdown', (event) => {
      const square = (event.target as Element).closest<HTMLElement>('[data-row]')
      if (!square) return
      event.preventDefault()
      this.clickSquare(Number(square.dataset.row), Number(square.dataset.col), event.pointerType === 'touch')
    })
    element.addEventListener('keydown', (event) => this.gridKey(event))
  }

  // --- keys -----------------------------------------------------------------

  private gridKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const { key } = event
    const at = this.position
    const arrow = arrowSteps[key]
    if (arrow) {
      event.preventDefault()
      if (arrow.direction === at.direction) {
        const moved = stepAlong(this.model, at, arrow.row, arrow.col)
        if (moved) this.select(moved)
      } else if (this.model.clueAt(arrow.direction, at.row, at.col)) this.select({ ...at, direction: arrow.direction })
      else {
        const moved = stepAlong(this.model, at, arrow.row, arrow.col)
        if (moved) this.select(moved)
      }
    } else if (key === ' ' || key === 'Enter') {
      event.preventDefault()
      this.switchDirection()
    } else if (key === 'Tab') {
      event.preventDefault()
      this.stepClue(event.shiftKey ? -1 : 1)
    } else if (key === 'Escape') this.pauseButton.focus()
    else if (key === 'Backspace') {
      event.preventDefault()
      this.backspace()
    } else if (key === 'Delete') {
      event.preventDefault()
      this.clearHere()
    } else if (key === '.') {
      event.preventDefault()
      this.togglePencil()
    } else if (key === 'Insert') {
      event.preventDefault()
      this.openEditor()
    } else if (/^[a-zA-Z]$/.test(key)) {
      event.preventDefault()
      this.type(key.toUpperCase())
    }
  }

  private shortcut(event: KeyboardEvent): void {
    if (!event.altKey || this.editor === document.activeElement || document.querySelector('dialog[open]')) return
    if (event.code === 'KeyC') this.openMenuFor('Check')
    else if (event.code === 'KeyR') this.openMenuFor('Reveal')
    else if (event.code === 'KeyX') this.openMenuFor('Clear')
    else if (event.code === 'KeyL' && document.activeElement === this.grid.element) this.linkedClue()
    else return
    event.preventDefault()
  }

  private pressKey(label: string): void {
    if (this.editor) {
      if (label === 'Backspace') this.editor.value = this.editor.value.slice(0, -1)
      else if (label === 'Rebus') this.commitEditor()
      else if (label.length === 1) this.editor.value = (this.editor.value + label).slice(0, REBUS_MAX)
      return
    }
    if (label === 'Backspace') this.backspace()
    else if (label === 'Rebus') this.openEditor()
    else if (label === 'Switch direction') this.switchDirection()
    else this.type(label)
  }

  // --- writing --------------------------------------------------------------

  private get canWrite(): boolean {
    return !this.dead && !this.watching
  }

  private togglePencil(): void {
    if (!this.canWrite) return
    this.pencil = !this.pencil
    this.paintStatus()
  }

  private type(value: string): void {
    if (!this.canWrite) return
    this.write(value)
  }

  /** Writes the whole entry of the selected square, then moves the cursor by the auto-advance rule. */
  private write(value: string): void {
    const { row, col } = this.position
    const current = this.store.get(row, col)
    const opId = crypto.randomUUID()
    if (!isLocked(current)) {
      this.store.expect(opId, { row, col, value, pencil: this.pencil, state: this.pencil ? 'pencil' : 'filled', owner: this.colourOf })
      this.paintOne(this.store.get(row, col))
    }
    this.send({ type: 'cell', row, col, value, pencil: this.pencil, client_op_id: opId }, opId)
    const next = advance(this.model, this.position, (r, c) => (r === row && c === col) || this.filled(r, c), this.settings)
    this.select(next)
  }

  private clearAt(row: number, col: number): void {
    const current = this.store.get(row, col)
    if (isLocked(current)) return
    const opId = crypto.randomUUID()
    this.store.expect(opId, emptySquare(row, col))
    this.paintOne(this.store.get(row, col))
    this.send({ type: 'cell', row, col, value: '', pencil: false, client_op_id: opId }, opId)
  }

  private clearHere(): void {
    if (this.canWrite) this.clearAt(this.position.row, this.position.col)
  }

  private backspace(): void {
    if (!this.canWrite) return
    const { row, col, direction } = this.position
    const current = this.store.get(row, col)
    if (isLocked(current)) return
    if (current.value !== '') {
      this.clearAt(row, col)
      return
    }
    const clue = this.activeClue()
    if (!clue) return
    const squares = this.model.squares(clue)
    const index = squares.findIndex((square) => square.row === row && square.col === col)
    if (index <= 0) return
    const before = squares[index - 1]
    this.select({ row: before.row, col: before.col, direction })
    this.clearAt(before.row, before.col)
  }

  private send(write: ClientWrite, opId: string | null = null): void {
    if (this.live?.isOpen()) {
      this.live.send(write)
      return
    }
    api<WriteMessage>('POST', `/api/games/${this.game.id}/ops`, write).then(
      (message) => this.receive(message),
      (failure: unknown) => {
        if (failure instanceof ApiFailure) this.receive({ type: 'error', code: failure.body.error, message: failure.message, client_op_id: opId })
      },
    )
  }

  // --- rebus ----------------------------------------------------------------

  private openEditor(): void {
    if (!this.canWrite || this.editor) return
    const editor = h('input', { type: 'text', class: 'rebus-editor', 'aria-label': 'Rebus entry', autocomplete: 'off', autocapitalize: 'characters', inputmode: 'none', maxlength: REBUS_MAX })
    editor.value = this.store.get(this.position.row, this.position.col).value
    editor.addEventListener('input', () => {
      editor.value = editor.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, REBUS_MAX)
    })
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.commitEditor()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        this.closeEditor()
      }
    })
    this.editor = editor
    this.grid.tile.append(editor)
    this.placeEditor()
    editor.focus()
  }

  private placeEditor(): void {
    const target = this.grid.squareElement(this.position.row, this.position.col)
    if (!this.editor || !target) return
    const base = this.grid.tile.getBoundingClientRect()
    const box = target.getBoundingClientRect()
    Object.assign(this.editor.style, { left: `${box.left - base.left}px`, top: `${box.top - base.top}px`, width: `${Math.max(box.width, 96)}px`, height: `${Math.max(box.height, 44)}px` })
  }

  private closeEditor(): void {
    this.editor?.remove()
    this.editor = null
    this.grid.element.focus()
  }

  private commitEditor(): void {
    const value = this.editor?.value ?? ''
    this.closeEditor()
    this.write(value)
  }

  // --- menus ----------------------------------------------------------------

  private openMenuFor(name: 'Check' | 'Reveal' | 'Clear'): void {
    if (!this.canWrite || this.menu) return
    const trigger = this.view.main.querySelector<HTMLButtonElement>(`[data-menu="${name}"]`)
    if (!trigger || trigger.disabled) return
    const scopes = name === 'Clear' ? ['Word', 'Puzzle'] : ['Square', 'Word', 'Puzzle']
    const items = scopes.map((label) => ({ label, disabled: this.race && (name === 'Clear' ? label === 'Puzzle' : label !== 'Square') }))
    const menu = openMenu(trigger, name, items, (label) => {
      this.menu = null
      this.pick(name, label.toLowerCase() as 'square' | 'word' | 'puzzle')
    })
    this.menu = { close: (focus) => (menu.close(focus), (this.menu = null)) }
    trigger.addEventListener('focus', () => (this.menu = null), { once: true })
  }

  private pick(name: 'Check' | 'Reveal' | 'Clear', scope: 'square' | 'word' | 'puzzle'): void {
    const finish = (): void => this.grid.element.focus()
    if (name === 'Clear' && scope === 'puzzle') {
      openClearConfirm(() => this.send({ type: 'clear', scope: 'puzzle', client_op_id: crypto.randomUUID() }), finish)
      return
    }
    const { row, col, direction } = this.position
    const target = scope === 'puzzle' ? {} : scope === 'square' ? { row, col } : { row, col, direction }
    this.send({ type: name.toLowerCase() as 'check' | 'reveal' | 'clear', scope, ...target, client_op_id: crypto.randomUUID() })
    finish()
  }

  // --- messages -------------------------------------------------------------

  private saveSettings(next: Settings): void {
    this.settings = next
    void api('PUT', '/api/players/me/settings', next).catch(() => undefined)
  }

  private downloadOriginal(): void {
    download(`/api/puzzles/${this.model.puzzle.id}/original`).then(
      (blob) => {
        this.view.band(null)
        saveBlob(blob, `${this.model.puzzle.id}.overlap.txt`)
      },
      (failure: unknown) => this.view.band(failure instanceof ApiFailure && failure.status === 503 ? STORAGE_DOWN : SOMETHING_WRONG),
    )
  }

  private settle(square: Square, opId: string | null = null): void {
    this.store.settle(square)
    const answered = this.store.answered(opId)
    this.paintOne(this.store.get(square.row, square.col))
    if (answered) {
      const [row, col] = answered.split(',').map(Number)
      this.paintOne(this.store.get(row, col))
    }
  }

  private markSquares(marks: readonly { row: number; col: number; state: Square['state']; value?: string; owner?: Square['owner'] }[]): void {
    for (const mark of marks) {
      const before = this.store.settled(mark.row, mark.col)
      this.settle({ ...marked(before, mark.state), value: mark.value ?? before.value, owner: mark.owner === undefined ? before.owner : mark.owner })
    }
  }

  private player(id: string): PlayerJson | undefined {
    return this.game.players.find((player) => player.id === id)
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'hello':
        this.game = message.game
        this.store.reset(message.game.squares)
        this.timer = { state: message.game.timer_state, base: message.game.elapsed_ms, at: performance.now() }
        this.paintSquares()
        this.paintSelection(null, false)
        this.paintPlayers()
        this.paintTimer()
        if (message.game.status === 'solved') this.markSolved()
        return
      case 'cell':
        this.settle({ row: message.row, col: message.col, value: message.value, pencil: message.pencil, state: message.state, owner: message.owner }, message.client_op_id)
        return
      case 'check': {
        this.markSquares(message.squares)
        this.store.answered(message.client_op_id)
        if (message.by === this.me) this.announce(message.wrong >= 1 ? `${message.wrong} wrong in this ${message.scope}` : `No errors in this ${message.scope}`)
        return
      }
      case 'reveal':
        this.markSquares(message.squares)
        if (message.by === this.me) this.announce(revealedPhrase(message.revealed))
        return
      case 'clear':
        for (const square of message.squares) this.settle(emptySquare(square.row, square.col))
        if (message.by === this.me) this.announce(message.cleared === 0 ? 'Nothing to clear' : message.cleared === 1 ? 'Cleared 1 square' : `Cleared ${message.cleared} squares`)
        return
      case 'claim': {
        this.settle({ row: message.row, col: message.col, value: message.value, pencil: false, state: 'right', owner: message.owner })
        const claimer = this.player(message.by)
        if (claimer) claimer.score += 1
        this.game.scores = message.scores
        this.paintPlayers()
        return
      }
      case 'cursor': {
        const order = this.game.players.findIndex((player) => player.id === message.player_id)
        this.cursors.set(message.player_id, { row: message.row, col: message.col, colour: message.colour, order })
        this.grid.paintCursors(this.cursors)
        return
      }
      case 'presence': {
        const known = this.player(message.player_id)
        if (known) known.present = message.present
        else this.game.players.push({ id: message.player_id, display_name: message.display_name, colour: message.colour, host: false, present: message.present, team: null, score: 0 })
        if (!message.present) {
          this.cursors.delete(message.player_id)
          this.grid.paintCursors(this.cursors)
        }
        if (message.player_id !== this.me) this.announce(`${message.display_name} ${message.present ? 'joined' : 'left'}`)
        this.paintPlayers()
        return
      }
      case 'timer':
        this.timer = { state: message.state, base: message.elapsed_ms, at: performance.now() }
        if (message.state === 'solved') this.markSolved()
        this.paintTimer()
        return
      case 'solved':
        this.timer = { state: 'solved', base: message.elapsed_ms, at: performance.now() }
        this.markSolved()
        this.paintTimer()
        this.announce(`Puzzle solved in ${formatTime(message.elapsed_ms)}`)
        openSolved(message.elapsed_ms, message.revealed_count, message.stats, this.reducedMotion, () => this.grid.element.focus())
        return
      case 'team': {
        const player = this.player(message.player_id)
        if (player) player.team = message.team
        this.paintPlayers()
        return
      }
      case 'race':
        this.game.race_state = message.state
        this.game.scores = message.scores
        this.paintPlayers()
        if (message.state === 'finished') openRaceOver(this.game.players, message.scores, this.reducedMotion, () => this.grid.element.focus())
        return
      case 'error':
        this.store.answered(message.client_op_id)
        this.paintSquares()
        this.notify(message.message)
        return
      case 'link_off':
        this.dead = true
        this.view.band(message.message)
    }
  }

  private markSolved(): void {
    this.game.status = 'solved'
    document.body.setAttribute('data-solved', '')
  }
}

