/** Shapes shared by the server's answers and the page (brief: API, Shared shapes). Tiles in JSON are [x, y]. */
import type { Heading, Tile } from './island'

export interface Player {
  id: string
  name: string
  handle: string
  /** Only in the player's own answers. */
  email?: string
  confirmed: boolean
  ranger: boolean
}

export interface Position { island: number; tile: Tile; heading: Heading }

export type Graphics = 'full' | 'balanced' | 'light'
export interface Settings { music: number; effects: number; graphics: Graphics }

export type Lighthouse = 'open' | 'closed'

export interface Score { size: number; centring: number; facing: number; sharpness: number; total: number }

export interface Measures {
  distance: number
  best_distance: number
  offset: number
  focus_error: number
  creature_facing: 'toward' | 'side' | 'away'
}

/** `<photo>` in the brief: a kept photo without measures, album and film. */
export interface Photo {
  id: string
  creature: string
  creature_name: string
  island: number
  tick: number
  score: Score
  image_url: string
}

export interface PhotoAnswer {
  photo: Photo & {
    measures: Measures
    album: { page_filled: boolean; pages_filled: number; stamp_earned: boolean }
    film: number
  }
}

export interface AlbumPage { creature: string; creature_name: string; filled: boolean; photo_id: string | null; total: number | null }
export interface Album { island: number; island_name: string; pages: AlbumPage[]; pages_filled: number; stamp: boolean }
export interface Albums { albums: Album[]; stamps: number; lighthouse: Lighthouse; film: number }

export interface Me {
  player: Player
  position: Position
  film: number
  stamps: number
  lighthouse: Lighthouse
  settings: Settings
}

export interface WorldCreature {
  id: string
  name: string
  island: number
  size: number
  x: number
  y: number
  heading: Heading
}

export interface World {
  world: string
  tick: number
  hour: number
  minute: number
  time: string
  weather: 'clear' | 'rain'
  dusk: boolean
  lighthouse?: Lighthouse
  creatures: WorldCreature[]
}

export type WorldEvent = Omit<World, 'world' | 'lighthouse'>

export interface HallFrame {
  frame: number
  caption: string
  photo: Photo
  likes: number
  liked_by_me?: boolean
}

export interface OwnHall { handle: string; public: boolean; frames: HallFrame[] }
export interface PublicHall { handle: string; owner_name: string; frames: HallFrame[] }

export type SafariStatus = 'open' | 'joined' | 'ended'
export interface Sighting { island: number; x: number; y: number; by: string }
export interface SafariPlayer { id: string; name: string }
export interface Safari {
  code: string
  status: SafariStatus
  host: SafariPlayer
  guest: SafariPlayer | null
  sightings?: Sighting[]
}

export type NoteStatus = 'pending' | 'approved' | 'declined'
export interface Note {
  id: string
  text: string
  author_name: string
  status: NoteStatus
  reason: string | null
  /** Ranger name, once decided. */
  decided_by?: string | null
}

export interface BoardEntry {
  rank: number
  player: string
  handle: string
  creature: string
  creature_name: string
  total: number
  tick: number
  photo: string
}
export interface Board { entries: BoardEntry[]; total: number; shown: number }

export interface PostcardPublic {
  id: string
  image_url: string
  creature_name: string
  total: number
  island_name: string
  line: string
  sender_name: string
}

/** What `GET /api/live` carries. One name per kind; the payload is its JSON data. */
export interface LiveEvents {
  /** The tick, weather and every creature, whenever the world's tick changes and on connect. */
  world: WorldEvent
  /** The player's albums, stamps, lighthouse and film (a photo, a refill) in every tab of that player. */
  progress: Albums
  /** Another tab of the same player moved. `tab` is the sender's tab id. */
  position: Position & { tab: string }
  /** The expedition restarted: everything back to the start. */
  restart: { position: Position; progress: Albums }
  /** The seated safari guest's page: where the host is now. */
  host_position: { island: number; tile: Tile }
  like: { photo: string; creature_name: string; likes: number; visitor: string; visitor_name: string; liked: boolean }
  note: { kind: 'pending' | 'approved' | 'declined' | 'removed'; note: Note }
  board: { island: number; player_name: string; rank: number }
  safari_joined: { guest_name: string; safari: Safari }
  safari_left: { guest_name: string; safari: Safari }
  safari_ended: { safari: Safari }
  sighting: { sighting: Sighting; host_name: string }
  safari_photo: { host_name: string; photo: Photo }
}

export type LiveEventName = keyof LiveEvents

/** Frames on a full roll. */
export const FULL_ROLL = 36
