/** `/play`: the explorer's world, its HUD, the map and album, photos, safaris, postcards and settings. */
import { ISLANDS, SPOTS, islandById, type Heading, type Tile } from '../../../shared/island'
import type { Albums, Me, Position, Safari, Settings, Graphics, World, WorldEvent } from '../../../shared/types'
import { webglAvailable } from '../../engine'
import { failureMessage, get, post, put } from '../../lib/api'
import { h } from '../../lib/dom'
import { closeLayer, openLayer, type Layer } from '../../lib/layers'
import { openLive, tabId } from '../../lib/live'
import { navigate, type Mounted, type PageContext } from '../../lib/router'
import { setVolumes, soundButton, releaseSoundButton } from '../../lib/sound'
import { status } from '../../lib/status'
import { textWorldContent } from '../../components/text-world-content'
import '../../styles/play.css'
import { albumPane } from './album'
import { joinDialog, postcardDialog, restartDialog, settingsDialog } from './dialogs'
import { buildHud } from './hud'
import { islandMap } from './map'
import { buildOverlay } from './overlay'
import { resultSheet } from './result'
import { safariPanel } from './safari'
import { Sheet, widePanel } from './sheet'
import { stillMap } from './still-map'
import { WorldView } from './world'

const GRAPHICS: readonly Graphics[] = ['full', 'balanced', 'light']
const NOTICE_UNKNOWN_SPOT = "That spot doesn't exist. You are at Saltmarsh Harbour, spot 1."
const NOTICE_NO_WEBGL = '3D is not available here. The text world below has everything.'

interface HistoryState { island: number; tile: Tile; heading: Heading }

const isHistoryState = (value: unknown): value is HistoryState =>
  typeof value === 'object' && value !== null && 'island' in value && 'tile' in value && 'heading' in value

/** The target position of this load: a deep link puts the explorer on its spot, otherwise the saved position. */
function resolveTarget(query: URLSearchParams, saved: Position): { position: Position; unknown: boolean; deepLink: boolean } {
  if (!query.has('island') && !query.has('spot')) return { position: saved, unknown: false, deepLink: false }
  const island = Number(query.get('island'))
  const spot = SPOTS.find((s) => s.spot === Number(query.get('spot')))
  if (!islandById(island) || !spot) {
    const first = SPOTS[0] as (typeof SPOTS)[number]
    return { position: { island: 1, tile: first.tile, heading: first.heading }, unknown: true, deepLink: true }
  }
  return { position: { island, tile: spot.tile, heading: spot.heading }, unknown: false, deepLink: true }
}

export function mountPlay(context: PageContext): Mounted {
  const disposers: (() => void)[] = []
  let dead = false
  document.body.classList.add('play-body')
  disposers.push(() => document.body.classList.remove('play-body'))
  void start(context, disposers, () => dead).catch((error: unknown) => {
    if (!dead) throw error
  })
  return {
    unmount() {
      dead = true
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

async function start(context: PageContext, disposers: (() => void)[], isDead: () => boolean): Promise<void> {
  const { root } = context
  const [me, world, albums, current] = await Promise.all([
    get<Me>('/api/me'), get<World>('/api/world'), get<Albums>('/api/me/albums'), get<{ safari: Safari | null }>('/api/safaris/current'),
  ])
  if (isDead()) return
  const target = resolveTarget(context.query, me.position)
  if (target.unknown) history.replaceState(null, '', '/play?island=1&spot=1')
  if (target.deepLink) await put('/api/me/position', target.position, { 'X-Tab-Id': tabId })
  if (isDead()) return
  const override = context.query.get('gfx')
  const forced = GRAPHICS.find((g) => g === override)
  let { position } = target
  let settings: Settings = me.settings
  const preset = (): Graphics => forced ?? settings.graphics
  setVolumes(settings.music, settings.effects)

  if (!webglAvailable()) {
    document.body.classList.remove('play-body')
    mountStill(root, position, disposers)
    return
  }

  // ---- regions, figures, HUD --------------------------------------------------------------------------------
  const regions = {
    world: status('World status', 5), photo: status('Photo status', 3), safari: status('Safari status', 5),
    postcard: status('Postcard status'), settings: status('Settings status'),
  }
  const sound = soundButton(position.island)
  disposers.push(() => releaseSoundButton(sound))
  const hud = buildHud(albums.film, albums.stamps, sound)
  hud.messages.append(regions.world.el, regions.photo.el, regions.safari.el, regions.postcard.el, regions.settings.el)
  const overlay = buildOverlay()
  const live = openLive()
  disposers.push(() => live.close())

  const state = { albums: albums.albums, stamps: albums.stamps, lighthouse: albums.lighthouse, safari: current.safari, restarting: false }
  const island = islandById(position.island)!

  // ---- saving the position ----------------------------------------------------------------------------------
  let saving = false
  let queued: Position | null = null
  const savePosition = async (next: Position): Promise<void> => {
    queued = next
    if (saving) return
    saving = true
    while (queued) {
      const body = queued
      queued = null
      try {
        await put('/api/me/position', body, { 'X-Tab-Id': tabId })
      } catch (error) {
        regions.world.say(failureMessage(error), { error: true })
      }
    }
    saving = false
  }

  // ---- the world view ---------------------------------------------------------------------------------------
  const map = islandMap({
    onWalk: (tile) => view.walkTo(tile),
    onSighting: (tile) => void markSighting(tile),
  })
  const view: WorldView = new WorldView({
    island, tile: position.tile, heading: position.heading, preset: preset(), lighthouse: albums.lighthouse,
    world, hud, overlay, worldStatus: regions.world, photoStatus: regions.photo,
    onMoved: (tile, heading) => {
      map.setExplorer(tile, heading)
      void savePosition({ island: view.island.id, tile, heading })
    },
    onPhotoKept: (photo, opener) => {
      hud.film.set(photo.film)
      result.show(photo, opener)
      void get<Albums>('/api/me/albums').then((fresh) => { if (!isDead()) applyProgress(fresh) })
    },
    openMap: () => openMap(),
    openAlbum: () => openAlbum(),
  })
  disposers.push(() => view.destroy())

  const pagesFilled = (islandId: number): number => state.albums.find((a) => a.island === islandId)?.pages_filled ?? 0

  const arrive = (next: Position, options: { message?: string; save?: boolean } = {}): void => {
    const where = islandById(next.island)!
    view.arrive(where, next.tile, next.heading)
    map.setIsland(where)
    map.setExplorer(next.tile, next.heading)
    album.select(where.id)
    album.refreshRefill()
    regions.world.say(options.message ?? `You are on ${where.name}. ${pagesFilled(where.id)} of 4 album pages filled.`)
    view.nearby()
    refreshSail()
    if (options.save) void savePosition(next)
  }

  // ---- progress: film, stamps, albums, lighthouse -------------------------------------------------------------
  const applyProgress = (progress: Albums, options: { announce?: boolean } = {}): void => {
    const announce = options.announce ?? true
    if (progress.film !== hud.film.value) hud.film.set(progress.film)
    if (announce) {
      for (const next of progress.albums) {
        const before = state.albums.find((a) => a.island === next.island)
        if (next.stamp && before && !before.stamp) {
          regions.world.say(`Stamp earned for ${next.island_name}. You have ${progress.stamps} ${progress.stamps === 1 ? 'stamp' : 'stamps'}.`)
        }
      }
      if (progress.lighthouse === 'open' && state.lighthouse === 'closed') regions.world.say('The lighthouse at Lantern Point is open.')
    }
    if (progress.stamps !== hud.stamps.value) hud.stamps.set(progress.stamps)
    state.albums = progress.albums
    state.stamps = progress.stamps
    state.lighthouse = progress.lighthouse
    view.setLighthouse(progress.lighthouse)
    album.update(progress)
  }

  // ---- sheets: map, album, the wide panel --------------------------------------------------------------------
  const sailButtons = ISLANDS.map((target) => h('button', {
    type: 'button', class: 'btn', onclick: () => sail(target.id),
  }, `Sail to ${target.name}`))
  const refreshSail = (): void => sailButtons.forEach((b, i) => { b.hidden = ISLANDS[i]?.id === view.island.id })
  const startSafari = h('button', { type: 'button', class: 'btn' }, 'Start a shared safari')
  const joinOpen = h('button', { type: 'button', class: 'btn' }, 'Join a safari')
  const mapClose = h('button', { type: 'button', class: 'btn' }, 'Close map')
  const mapPane = h('section', { class: 'map-pane', 'aria-label': 'Map pane' },
    h('header', { class: 'pane-head' }, h('h2', null, 'Map'), mapClose),
    map.el,
    h('div', { class: 'pane-actions' }, sailButtons, startSafari, joinOpen, h('a', { class: 'btn', href: '/board' }, 'Notice board')))
  const album = albumPane({
    island: () => view.island.id,
    film: () => hud.film.value,
    onClose: () => closeAll(),
    onRefill: () => void refill(),
    onPostcard: (photoId, creatureName, opener) => { postcard.prepare(photoId, creatureName); postcard.open(opener) },
  })
  album.update(albums, { instant: true })
  album.select(island.id)

  const mapDialog = h('div', { role: 'dialog', 'aria-label': 'Map', class: 'sheet map-sheet' })
  const albumDialog = h('div', { role: 'dialog', 'aria-label': 'Album', class: 'sheet album-sheet' })
  const share = { value: 50 }
  const separator = h('div', {
    role: 'separator', 'aria-label': 'Resize map and album', 'aria-orientation': 'vertical', 'aria-valuemin': 30, 'aria-valuemax': 70,
    'aria-valuenow': 50, tabindex: 0, class: 'panel-separator',
  })
  const panel = h('aside', { role: 'complementary', 'aria-label': 'Map and album', class: 'sheet panel' })
  const layersRoot = document.getElementById('layers') as HTMLElement
  layersRoot.append(mapDialog, albumDialog, panel)
  disposers.push(() => { mapDialog.remove(); albumDialog.remove(); panel.remove() })

  const setShare = (value: number): void => {
    share.value = Math.min(70, Math.max(30, value))
    separator.setAttribute('aria-valuenow', String(share.value))
    panel.style.setProperty('--map-share', `${share.value}%`)
    fitMap()
  }
  separator.addEventListener('keydown', (event) => {
    const next = event.key === 'ArrowLeft' ? share.value - 5 : event.key === 'ArrowRight' ? share.value + 5
      : event.key === 'Home' ? 30 : event.key === 'End' ? 70 : null
    if (next === null) return
    event.preventDefault()
    setShare(next)
  })
  separator.addEventListener('pointerdown', (event) => {
    separator.setPointerCapture(event.pointerId)
    const drag = (move: PointerEvent): void => {
      const box = panel.getBoundingClientRect()
      setShare(Math.round(((move.clientX - box.left) / box.width) * 20) * 5)
    }
    separator.addEventListener('pointermove', drag)
    separator.addEventListener('pointerup', () => separator.removeEventListener('pointermove', drag), { once: true })
  })

  const place = (): void => {
    if (widePanel()) {
      panel.replaceChildren(mapPane, separator, album.el)
      panel.style.setProperty('--map-share', `${share.value}%`)
    } else {
      mapDialog.replaceChildren(mapPane)
      albumDialog.replaceChildren(album.el)
    }
  }
  const fitMap = (): void => {
    if (mapPane.clientWidth > 0) map.fit(mapPane.clientWidth - 32)
  }

  const sheets = {
    map: new Sheet(mapDialog), album: new Sheet(albumDialog), panel: new Sheet(panel),
  }
  const layers: Record<'map' | 'album' | 'panel', Layer> = {
    map: { el: mapDialog, modal: true, dismiss: () => closeAll(), initial: () => map.el },
    album: { el: albumDialog, modal: true, dismiss: () => closeAll(), initial: () => album.closeButton },
    panel: { el: panel, modal: false, dismiss: () => closeAll() },
  }
  let openSheet: 'map' | 'album' | 'panel' | null = null
  const showSheet = (which: 'map' | 'album' | 'panel', opener: HTMLElement | null, initial: () => HTMLElement | null): void => {
    if (openSheet && openSheet !== which) {
      const previous = openSheet
      const keep = layers[previous].opener
      sheets[previous].hide()
      closeLayer(layers[previous])
      opener = opener ?? keep ?? null
    }
    if (openSheet !== which) {
      sheets[which].show()
      layers[which].opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      layers[which].initial = initial
      openLayer(layers[which])
      openSheet = which
    } else {
      initial()?.focus()
    }
    fitMap()
    if (which !== 'album') { map.resetCursor(view.tile); map.setExplorer(view.tile, view.heading) }
  }
  function closeAll(): void {
    if (!openSheet) return
    const which = openSheet
    openSheet = null
    sheets[which].hide()
    closeLayer(layers[which])
  }
  const openMap = (opener?: HTMLElement): void => {
    const active = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    showSheet(widePanel() ? 'panel' : 'map', active, () => map.el)
  }
  const openAlbum = (opener?: HTMLElement): void => {
    const active = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    showSheet(widePanel() ? 'panel' : 'album', active, () => album.selectedTab())
  }
  const wide = matchMedia('(min-width: 1200px)')
  const onLayout = (): void => { closeAll(); place() }
  wide.addEventListener('change', onLayout)
  disposers.push(() => wide.removeEventListener('change', onLayout))
  place()
  mapClose.addEventListener('click', () => closeAll())
  hud.map.addEventListener('click', () => openMap(hud.map))
  hud.album.addEventListener('click', () => openAlbum(hud.album))
  const resized = (): void => { if (openSheet) fitMap() }
  window.addEventListener('resize', resized)
  disposers.push(() => window.removeEventListener('resize', resized))
  map.setIsland(island)
  map.setExplorer(position.tile, position.heading)
  refreshSail()
  fitMap()

  // ---- photo result and postcards -------------------------------------------------------------------------------
  const result = resultSheet({
    onPostcard: (photoId, creatureName, opener) => { postcard.prepare(photoId, creatureName); postcard.open(opener) },
  })
  disposers.push(() => result.destroy())
  const postcard = postcardDialog({
    docked: { status: regions.postcard, home: hud.messages },
    send: async (draft, requestKey) => {
      regions.postcard.clear()
      regions.postcard.say('Posting…')
      try {
        await post('/api/postcards', draft, { 'Request-Key': requestKey })
        regions.postcard.clear()
        regions.postcard.say('Postcard posted.')
        return true
      } catch (error) {
        regions.postcard.clear()
        regions.postcard.say(failureMessage(error), { error: true })
        return false
      }
    },
  })
  disposers.push(() => postcard.destroy())

  // ---- refill, restart, settings -------------------------------------------------------------------------------
  const refill = async (): Promise<void> => {
    try {
      const { film } = await post<{ film: number }>('/api/me/refill')
      regions.world.say(`Film refilled to ${film} frames.`)
      hud.film.set(film)
      album.refreshRefill()
    } catch (error) {
      regions.world.say(failureMessage(error), { error: true })
    }
  }

  const applyRestart = (payload: { position: Position; progress: Albums }, announce: boolean): void => {
    applyProgress(payload.progress, { announce: false })
    if (location.search.includes('island')) history.replaceState({ ...payload.position }, '', '/play')
    arrive(payload.position, { message: announce ? 'Expedition restarted. You are on Saltmarsh Harbour.' : undefined })
    album.refreshRefill()
  }
  const restart = restartDialog({
    restart: async () => {
      state.restarting = true
      try {
        const answer = await post<{ position: Position; film: number }>('/api/me/restart')
        const fresh = await get<Albums>('/api/me/albums')
        applyRestart({ position: answer.position, progress: fresh }, true)
      } catch (error) {
        regions.world.say(failureMessage(error), { error: true })
      } finally {
        state.restarting = false
      }
    },
  })
  disposers.push(() => restart.destroy())
  hud.restart.addEventListener('click', () => restart.open(hud.restart))

  const settingsModal = settingsDialog({
    current: () => settings,
    docked: { status: regions.settings, home: hud.messages },
    save: async (next) => {
      const saved = await put<{ settings: Settings }>('/api/me/settings', next)
      settings = saved.settings
      setVolumes(settings.music, settings.effects)
      view.setPreset(preset())
    },
  })
  disposers.push(() => settingsModal.destroy())
  hud.settings.addEventListener('click', () => settingsModal.open(hud.settings))

  // ---- safari -------------------------------------------------------------------------------------------------
  const safari = safariPanel({ playerId: me.player.id, onEnd: () => void endSafari(), onLeave: () => void leaveSafari() })
  hud.safariSlot.append(safari.el)
  const showSafari = (next: Safari | null): void => {
    state.safari = next
    safari.set(next)
    map.setSightings(safari.sightings)
    if (!next || next.status === 'ended' || next.host.id === me.player.id) view.setHost(null)
  }
  showSafari(current.safari)

  const trySafari = async (run: () => Promise<void>): Promise<boolean> => {
    try {
      await run()
      return true
    } catch (error) {
      regions.safari.say(failureMessage(error), { error: true })
      return false
    }
  }
  startSafari.addEventListener('click', () => void trySafari(async () => {
    const { safari: started } = await post<{ safari: Safari }>('/api/safaris')
    showSafari(started)
    regions.safari.say('Safari started.')
  }))
  const join = joinDialog({
    docked: { status: regions.safari, home: hud.messages },
    join: (code) => trySafari(async () => {
      const { safari: joined } = await post<{ safari: Safari }>(`/api/safaris/${code}/join`)
      showSafari(joined)
      regions.safari.say(`You joined ${joined.host.name}'s safari.`)
    }),
  })
  disposers.push(() => join.destroy())
  joinOpen.addEventListener('click', () => join.open(joinOpen))
  const endSafari = (): Promise<boolean> => trySafari(async () => {
    await post(`/api/safaris/${state.safari?.code}/end`)
    showSafari(null)
    regions.safari.say('Safari ended.')
  })
  const leaveSafari = (): Promise<boolean> => trySafari(async () => {
    const guest = me.player.name
    await post(`/api/safaris/${state.safari?.code}/leave`)
    showSafari(null)
    view.setHost(null)
    regions.safari.say(`${guest} left. The guest seat is free.`)
  })
  const markSighting = async (tile: Tile): Promise<void> => {
    const open = state.safari
    if (!open || open.host.id !== me.player.id || open.status === 'ended') return
    await trySafari(async () => {
      await post(`/api/safaris/${open.code}/sightings`, { island: view.island.id, tile })
    })
  }

  // ---- links: sailing and Back -----------------------------------------------------------------------------------
  const sail = (islandId: number): void => {
    history.replaceState({ island: view.island.id, tile: view.tile, heading: view.heading } satisfies HistoryState, '')
    const spot = SPOTS[0] as (typeof SPOTS)[number]
    const next: Position = { island: islandId, tile: spot.tile, heading: spot.heading }
    history.pushState({ ...next } satisfies HistoryState, '', `/play?island=${islandId}&spot=1`)
    arrive(next, { save: true })
  }
  context.onPop((popped) => {
    if (!isHistoryState(popped)) {
      void navigate(location.pathname + location.search, { replace: true })
      return
    }
    arrive({ island: popped.island, tile: popped.tile, heading: popped.heading }, { save: true })
  })
  history.replaceState({ island: position.island, tile: position.tile, heading: position.heading } satisfies HistoryState, '')

  // ---- live ---------------------------------------------------------------------------------------------------
  live.on('world', (event: WorldEvent) => view.setWorld(event))
  live.on('progress', (progress) => applyProgress(progress))
  live.on('restart', (payload) => {
    if (state.restarting) return
    applyRestart(payload, true)
  })
  live.on('position', (moved) => {
    if (moved.tab !== tabId && moved.island !== view.island.id) arrive({ island: moved.island, tile: moved.tile, heading: moved.heading })
  })
  live.on('host_position', (host) => view.setHost(host))
  live.on('safari_joined', ({ guest_name, safari: joined }) => {
    showSafari(joined)
    regions.safari.say(`${guest_name} joined your safari.`)
  })
  live.on('safari_left', ({ guest_name, safari: left }) => {
    showSafari(left.host.id === me.player.id ? left : null)
    regions.safari.say(`${guest_name} left. The guest seat is free.`)
  })
  live.on('safari_ended', () => {
    showSafari(null)
    regions.safari.say('Safari ended.')
  })
  live.on('sighting', ({ sighting }) => {
    safari.addSighting(sighting)
    map.setSightings(safari.sightings)
    regions.safari.say(`Sighting at ${sighting.x}, ${sighting.y} by ${sighting.by}`)
  })
  live.on('safari_photo', ({ host_name, photo }) => safari.addFeed(host_name, photo))

  // ---- assemble -----------------------------------------------------------------------------------------------
  const page = h('div', { class: 'play' }, hud.skip, view.el, hud.bar)
  root.replaceChildren(page)
  fitMap()
  if (target.unknown) regions.world.say(NOTICE_UNKNOWN_SPOT)
  arrive(position)
  disposers.push(() => root.replaceChildren())
}

/** No WebGL: the still map, the notice and the whole text world, with no error shown. */
function mountStill(root: HTMLElement, position: Position, disposers: (() => void)[]): void {
  const live = openLive()
  disposers.push(() => live.close())
  const words = textWorldContent({ live })
  disposers.push(() => words.unmount())
  const where = islandById(position.island)!
  root.replaceChildren(h('main', { class: 'play-still', 'data-state': 'still', 'data-island': where.id },
    h('div', { class: 'still-frame' }, stillMap(where)),
    h('p', { class: 'still-notice' }, NOTICE_NO_WEBGL),
    words.el))
  disposers.push(() => root.replaceChildren())
}
