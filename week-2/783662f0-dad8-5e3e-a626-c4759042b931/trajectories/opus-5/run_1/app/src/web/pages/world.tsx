import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as copy from '../../shared/copy.js';
import { COPY } from '../../shared/copy.js';
import {
  ITEM_NAMES,
  type Material,
  MATERIALS,
  TILE_LABELS,
  type TileCode,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../../shared/domain.js';
import type {
  CharacterObject,
  MessageObject,
  PartyObject,
  ServerObject,
  TableObject,
  TradeObject,
  WeatherObject,
  WorldObject,
} from '../../shared/types.js';
import { ApiFailure, get, post, remove } from '../api.js';
import { blockPlace, blockShards, countCoins, driveVehicle, nightTint } from '../motion.js';
import { useRouter } from '../router.js';
import { SoundToggle, useRoster } from '../shell.js';
import { play } from '../sound.js';
import { useServerStream, useWorldStream } from '../stream.js';
import { Status, useGrid, useInterval, useWidthBand } from '../ui.js';
import { InventoryDialog, OfferTradeDialog, TradeDialog } from './dialogs.js';
import { TablePanel } from './table.js';

const MATERIAL_LABELS: Readonly<Record<Material, string>> = {
  wood: 'Wood',
  stone: 'Stone',
  brick: 'Brick',
  glass: 'Glass',
};

interface Props {
  readonly slug: string;
  readonly world: string;
  readonly tableId: string | null;
  readonly server: ServerObject | null;
}

export function WorldPage({ slug, world, tableId, server }: Props): ReactNode {
  const { go } = useRouter();
  const band = useWidthBand();

  const { activeId, active, reload: reloadCharacters } = useRoster();
  const [record, setRecord] = useState<WorldObject | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [achievement, setAchievement] = useState('');
  const [material, setMaterial] = useState<Material>('stone');
  const [messages, setMessages] = useState<MessageObject[]>([]);
  const [draft, setDraft] = useState('');
  const [parties, setParties] = useState<PartyObject[]>([]);
  const [partyName, setPartyName] = useState('');
  const [weather, setWeather] = useState<WeatherObject | null>(null);
  const [parking, setParking] = useState<{ id: string; name: string; kind: 'car' | 'plane' } | null>(
    null,
  );
  const [vehicleMenuFor, setVehicleMenuFor] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [chatShown, setChatShown] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [railOverlay, setRailOverlay] = useState(false);
  const [fullScreenChat, setFullScreenChat] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [trade, setTrade] = useState<TradeObject | null>(null);
  const [table, setTable] = useState<TableObject | null>(null);
  const [shownBalance, setShownBalance] = useState(0);

  const root = useRef<HTMLDivElement>(null);
  const nightLayer = useRef<HTMLDivElement>(null);
  const coinCounter = useRef<HTMLSpanElement>(null);
  const fullScreenButton = useRef<HTMLButtonElement>(null);
  const inspectorFirst = useRef<HTMLButtonElement>(null);
  const vehicleMenu = useRef<HTMLDivElement>(null);
  const watchButton = useRef<HTMLButtonElement>(null);
  const mapHost = useRef<HTMLDivElement>(null);
  const previousWeather = useRef<string | null>(null);

  const grid = useGrid(WORLD_WIDTH, WORLD_HEIGHT, { x: 16, y: 8 });

  const reloadWorld = useCallback(async () => {
    setRecord(await get<WorldObject>(`/api/servers/${slug}/worlds/${world}`));
  }, [slug, world]);

  const reloadParties = useCallback(async () => {
    setParties((await get<{ parties: PartyObject[] }>(`/api/servers/${slug}/parties`)).parties);
  }, [slug]);

  useEffect(() => {
    void reloadWorld();
    void reloadParties();
    void get<{ messages: MessageObject[] }>(`/api/servers/${slug}/worlds/${world}/chat`).then(
      (answer) => setMessages(answer.messages),
    );
    void get<WeatherObject>(`/api/servers/${slug}/weather`).then(setWeather);
  }, [reloadWorld, reloadParties, slug, world]);

  /* The tile cursor starts on the active character's tile, and follows a
     change of active character. */
  const placedFor = useRef<string | null>(null);
  useEffect(() => {
    if (active === null || placedFor.current === active.id) return;
    placedFor.current = active.id;
    grid.setCursor({ x: active.x, y: active.y });
    // The cursor is placed once per active character, not on every step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  /* The browser re-reads the weather every 60 seconds. */
  useInterval(60000, () => {
    void get<WeatherObject>(`/api/servers/${slug}/weather`).then(setWeather);
  });

  useEffect(() => {
    if (weather === null) return;
    nightTint(nightLayer.current, weather.night_level);
    if (previousWeather.current !== null && previousWeather.current !== weather.weather) {
      setAnnouncement(
        weather.weather === 'clear'
          ? COPY.weatherClear
          : weather.weather === 'rain'
            ? COPY.weatherRain
            : COPY.weatherStorm,
      );
    }
    previousWeather.current = weather.weather;
  }, [weather]);

  /* The coin counter counts to the ledger balance after every change. */
  useEffect(() => {
    if (active === null) return;
    const from = shownBalance;
    if (from === active.balance) return;
    countCoins(coinCounter.current, from, active.balance, setShownBalance);
    // The animation runs from whatever was shown to the newest balance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.balance]);

  useWorldStream(slug, world, (event) => {
    if (event.kind === 'world') {
      const payload = event.payload as Partial<WorldObject> & { announcement?: string };
      if (typeof payload.announcement === 'string') {
        setAnnouncement(payload.announcement);
        return;
      }
      if (payload.slug !== undefined) setRecord(payload as WorldObject);
      else void reloadWorld();
    } else if (event.kind === 'chat') {
      const message = event.payload as MessageObject;
      setMessages((current) =>
        current.some((entry) => entry.id === message.id) ? current : [...current, message],
      );
    }
  });

  useServerStream(slug, (event) => {
    if (event.kind === 'weather') setWeather(event.payload as WeatherObject);
    else if (event.kind === 'party') void reloadParties();
    else if (event.kind === 'trade') {
      const next = event.payload as TradeObject;
      setTrade(next.state === 'open' ? next : null);
      if (next.state === 'open' && trade === null) {
        const other = next.sides.find((side) => side.character_id !== activeId);
        if (other !== undefined) setAnnouncement(copy.tradeOffered(other.name));
      }
    } else if (event.kind === 'achievement') {
      const payload = event.payload as { name: string };
      setAchievement(copy.achievementUnlocked(payload.name));
    } else if (event.kind === 'snapshot') {
      const payload = event.payload as { weather: WeatherObject };
      setWeather(payload.weather);
    }
  });

  /* The toast stays 5 seconds on its own timer and never takes focus. */
  useEffect(() => {
    if (achievement === '') return;
    const timer = setTimeout(() => setAchievement(''), 5000);
    return () => clearTimeout(timer);
  }, [achievement]);

  /* Opening the table route restores the panel. */
  useEffect(() => {
    if (tableId === null) {
      setTable(null);
      return;
    }
    void get<TableObject>(`/api/tables/${tableId}`)
      .then(setTable)
      .catch(() => setTable(null));
  }, [tableId]);

  useEffect(() => {
    const onChange = (): void => setFullScreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const tiles = record?.tiles ?? [];
  const tileAt = (x: number, y: number): TileCode =>
    ((tiles[y] ?? '')[x] ?? '.') as TileCode;

  const blockAt = (x: number, y: number) =>
    record?.blocks.find((block) => block.x === x && block.y === y) ?? null;
  const vehicleAt = (x: number, y: number) =>
    record?.vehicles.find((vehicle) => vehicle.x === x && vehicle.y === y) ?? null;
  const tableAt = (x: number, y: number) =>
    record?.tables.find((entry) => entry.x === x && entry.y === y) ?? null;
  const charactersAt = (x: number, y: number) =>
    (record?.characters ?? [])
      .filter((character) => character.x === x && character.y === y)
      .sort((a, b) => a.name.localeCompare(b.name));

  const tileLabel = (x: number, y: number): string => {
    const found = tableAt(x, y);
    return found !== null ? found.name : TILE_LABELS[tileAt(x, y)];
  };

  /** Contents are joined with ", ": block, vehicle, then names alphabetically. */
  const cellName = (x: number, y: number): string => {
    const parts: string[] = [];
    const block = blockAt(x, y);
    if (block !== null) parts.push(`${block.material} block`);
    const vehicle = vehicleAt(x, y);
    if (vehicle !== null) parts.push(vehicle.name);
    for (const character of charactersAt(x, y)) parts.push(character.name);
    const base = `${x}, ${y}, ${tileLabel(x, y)}`;
    return parts.length === 0 ? base : `${base}, ${parts.join(', ')}`;
  };

  const cursorTile = grid.cursor;
  const cursorBlock = blockAt(cursorTile.x, cursorTile.y);
  const cursorVehicle = vehicleAt(cursorTile.x, cursorTile.y);
  const cursorTable = tableAt(cursorTile.x, cursorTile.y);
  const myVehicle =
    cursorVehicle !== null && active !== null && cursorVehicle.owner_character_id === active.id
      ? cursorVehicle
      : null;

  const walk = async (direction: 'north' | 'east' | 'south' | 'west'): Promise<void> => {
    if (active === null) return;
    try {
      const answer = await post<{ character: CharacterObject; announcement: string }>(
        `/api/characters/${active.id}/walk`,
        { direction },
      );
      setAnnouncement(answer.announcement);
      await reloadCharacters();
      await reloadWorld();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setAnnouncement(error.code === 'blocked' ? COPY.blocked : refusalCopy(error));
      }
    }
  };

  const placeBlock = async (x: number, y: number): Promise<void> => {
    if (active === null) return;
    try {
      const answer = await post<{ announcement: string }>(
        `/api/servers/${slug}/worlds/${world}/blocks`,
        { character_id: active.id, x, y, material },
      );
      setAnnouncement(answer.announcement);
      await reloadWorld();
      blockPlace(
        mapHost.current?.querySelector<HTMLElement>(`[data-tile="${x}-${y}"] .block`) ?? null,
      );
    } catch (error) {
      if (error instanceof ApiFailure) setAnnouncement(refusalCopy(error));
    }
  };

  const breakBlock = async (x: number, y: number): Promise<void> => {
    if (active === null) return;
    const host = mapHost.current?.querySelector<HTMLElement>(`[data-tile="${x}-${y}"]`) ?? null;
    try {
      const answer = await post<{ announcement: string }>(
        `/api/servers/${slug}/worlds/${world}/blocks/break`,
        { character_id: active.id, x, y },
      );
      setAnnouncement(answer.announcement);
      blockShards(host);
      await reloadWorld();
    } catch (error) {
      if (error instanceof ApiFailure) setAnnouncement(refusalCopy(error));
    }
  };

  const startParking = (vehicle: { id: string; name: string; kind: 'car' | 'plane' }): void => {
    setParking(vehicle);
    setVehicleMenuFor(null);
    setAnnouncement(copy.parkingPrompt(vehicle.name, vehicle.kind === 'car' ? 'road' : 'runway'));
    if (band === 'small') setDrawerOpen(false);
  };

  const cancelParking = (): void => {
    const vehicle = parking;
    setParking(null);
    setAnnouncement(COPY.parkingCancelled);
    if (vehicle !== null && record !== null) {
      const found = record.vehicles.find((entry) => entry.id === vehicle.id);
      if (found !== undefined) grid.focusCell(found.x, found.y);
    }
  };

  const park = async (x: number, y: number): Promise<void> => {
    if (parking === null) return;
    const vehicle = parking;
    try {
      const answer = await post<{
        announcement: string;
        trip: { steps: string[] };
      }>(`/api/vehicles/${vehicle.id}/park`, { x, y });
      setParking(null);
      setAnnouncement(answer.announcement);
      const sprite =
        mapHost.current?.querySelector<HTMLElement>(`[data-vehicle="${vehicle.id}"]`) ?? null;
      await driveVehicle(sprite, answer.trip.steps, band === 'small' ? 44 : 32, () => undefined);
      await reloadWorld();
    } catch (error) {
      if (error instanceof ApiFailure) setAnnouncement(parkRefusal(error, vehicle.kind));
    }
  };

  /* In parking mode the guidance copy is announced on a wrong-surface tile. */
  const lastGuided = useRef<string>('');
  useEffect(() => {
    if (parking === null) {
      lastGuided.current = '';
      return;
    }
    const wanted: TileCode = parking.kind === 'car' ? '=' : '#';
    const key = `${cursorTile.x},${cursorTile.y}`;
    if (key === lastGuided.current) return;
    lastGuided.current = key;
    if (tileAt(cursorTile.x, cursorTile.y) !== wanted) {
      setAnnouncement(parking.kind === 'car' ? COPY.notARoad : COPY.notARunway);
    }
    // Guidance follows the cursor while parking mode is on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parking, cursorTile.x, cursorTile.y]);

  const takeSeat = async (entry: { id: string }, watching: boolean): Promise<void> => {
    if (active === null) return;
    try {
      if (watching) {
        await post(`/api/tables/${entry.id}/spectators`, { character_id: active.id });
        setAnnouncement(copy.watching(tableAt(cursorTile.x, cursorTile.y)?.name ?? ''));
      } else {
        const answer = await post<{ seat: { label: string }; announcement: string }>(
          `/api/tables/${entry.id}/seats`,
          { character_id: active.id },
        );
        setAnnouncement(answer.announcement);
        play('seat-taken');
      }
      go(`/s/${slug}/w/${world}/t/${entry.id}`);
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === 'table_full') {
          setAnnouncement(COPY.tableFull);
          watchButton.current?.focus();
        } else {
          setAnnouncement(refusalCopy(error));
        }
      }
    }
  };

  const toggleFullScreen = (): void => {
    const node = root.current;
    if (node === null) return;
    if (document.fullscreenElement === node) {
      void document.exitFullscreen().then(() => fullScreenButton.current?.focus());
      return;
    }
    node.requestFullscreen().catch(() => setAnnouncement(COPY.fullScreenUnavailable));
  };

  const myParty = useMemo(
    () =>
      parties.find((party) =>
        party.members.some((member) => member.character_id === activeId),
      ) ?? null,
    [parties, activeId],
  );

  const onWorldKey = (event: React.KeyboardEvent): void => {
    if (
      event.target instanceof HTMLElement &&
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (event.shiftKey && event.key.startsWith('Arrow')) {
      event.preventDefault();
      const direction =
        event.key === 'ArrowUp'
          ? 'north'
          : event.key === 'ArrowDown'
            ? 'south'
            : event.key === 'ArrowLeft'
              ? 'west'
              : 'east';
      void walk(direction);
      return;
    }
    if (key === 'b') {
      event.preventDefault();
      void placeBlock(cursorTile.x, cursorTile.y);
    } else if (key === 'x') {
      event.preventDefault();
      void breakBlock(cursorTile.x, cursorTile.y);
    } else if (key === 'i') {
      event.preventDefault();
      setInventoryOpen(true);
    } else if (key === 'f') {
      event.preventDefault();
      toggleFullScreen();
    } else if (key === 'r' && fullScreen) {
      event.preventDefault();
      setRailOverlay((shown) => !shown);
    } else if (key === 'c' && fullScreen) {
      event.preventDefault();
      setFullScreenChat((shown) => !shown);
    } else if (event.key === 'Escape' && parking !== null) {
      event.preventDefault();
      cancelParking();
    }
  };

  const partySection = (
    <section role="region" aria-label="Party">
      <h3>Party</h3>
      <ul aria-label="Party members">
        {(myParty?.members ?? []).map((member) => (
          <li key={member.character_id}>
            {`${member.name}${myParty?.leader_id === member.character_id ? ' Leader' : ''}`}
          </li>
        ))}
      </ul>
      {myParty === null ? (
        <>
          <label htmlFor="party-name">Party name</label>
          <input
            id="party-name"
            type="text"
            aria-label="Party name"
            value={partyName}
            onChange={(event) => setPartyName(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              if (active === null) return;
              void post(`/api/servers/${slug}/parties`, {
                character_id: active.id,
                name: partyName,
              })
                .then(reloadParties)
                .catch((error: unknown) => {
                  if (error instanceof ApiFailure) setAnnouncement(refusalCopy(error));
                });
            }}
          >
            Start party
          </button>
          {parties.map((party) => (
            <button
              key={party.id}
              type="button"
              onClick={() => {
                if (active === null) return;
                void post(`/api/parties/${party.id}/members`, { character_id: active.id })
                  .then(reloadParties)
                  .catch(() => undefined);
              }}
            >
              {`Join ${party.name}`}
            </button>
          ))}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              if (active === null) return;
              void remove(`/api/parties/${myParty.id}/members/${active.id}`)
                .then(reloadParties)
                .catch(() => undefined);
            }}
          >
            Leave party
          </button>
          {myParty.leader_id === activeId ? (
            <button
              type="button"
              onClick={() => {
                void post(`/api/parties/${myParty.id}/chapter-runs`, {
                  chapter_id: 'surveyors-pegs',
                })
                  .then(reloadParties)
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure) setAnnouncement(refusalCopy(error));
                  });
              }}
            >
              Start chapter
            </button>
          ) : null}
        </>
      )}
    </section>
  );

  const inspectorSection = (
    <section role="region" aria-label="Tile inspector">
      <h3>Tile inspector</h3>
      <p className="coords mono">{`${cursorTile.x}, ${cursorTile.y}`}</p>
      <p>{cellName(cursorTile.x, cursorTile.y)}</p>
      <fieldset role="radiogroup" aria-label="Block material">
        <legend>Block material</legend>
        {MATERIALS.map((option) => (
          <label className="radio-row" key={option}>
            <input
              type="radio"
              name="material"
              checked={material === option}
              aria-label={MATERIAL_LABELS[option]}
              onChange={() => setMaterial(option)}
            />
            <span>{MATERIAL_LABELS[option]}</span>
          </label>
        ))}
      </fieldset>
      <div className="row" onKeyDown={onWorldKey}>
        {active !== null &&
        Math.abs(active.x - cursorTile.x) + Math.abs(active.y - cursorTile.y) === 1 ? (
          <button
            type="button"
            ref={inspectorFirst}
            onClick={() => {
              const direction =
                cursorTile.y < active.y
                  ? 'north'
                  : cursorTile.y > active.y
                    ? 'south'
                    : cursorTile.x > active.x
                      ? 'east'
                      : 'west';
              void walk(direction);
            }}
          >
            Walk here
          </button>
        ) : null}
        {(tileAt(cursorTile.x, cursorTile.y) === '.' ||
          tileAt(cursorTile.x, cursorTile.y) === 's') &&
        cursorBlock === null ? (
          <button type="button" onClick={() => void placeBlock(cursorTile.x, cursorTile.y)}>
            Place block
          </button>
        ) : null}
        {cursorBlock !== null ? (
          <button type="button" onClick={() => void breakBlock(cursorTile.x, cursorTile.y)}>
            Break block
          </button>
        ) : null}
        {cursorTable !== null ? (
          <>
            <button type="button" onClick={() => void takeSeat(cursorTable, false)}>
              Take seat
            </button>
            <button
              type="button"
              ref={watchButton}
              onClick={() => void takeSeat(cursorTable, true)}
            >
              Watch
            </button>
          </>
        ) : null}
        {myVehicle !== null && parking === null ? (
          <button type="button" onClick={() => startParking(myVehicle)}>
            {`Move ${myVehicle.name}`}
          </button>
        ) : null}
        {parking !== null ? (
          <>
            <button type="button" onClick={() => void park(cursorTile.x, cursorTile.y)}>
              Park here
            </button>
            <button type="button" onClick={cancelParking}>
              Cancel parking
            </button>
          </>
        ) : null}
      </div>
    </section>
  );

  const chatSection = (
    <section role="region" aria-label="Chat">
      <h3>Chat</h3>
      <div role="log" aria-label="Chat messages" aria-live="polite" className="chat-log">
        {messages.map((message) => (
          <p key={message.id}>{`${message.character.name}: ${message.text}`}</p>
        ))}
      </div>
      <label htmlFor="chat-message">Message</label>
      <input
        id="chat-message"
        type="text"
        aria-label="Message"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          if (active === null) return;
          void post<{ message: MessageObject }>(`/api/servers/${slug}/worlds/${world}/chat`, {
            character_id: active.id,
            text: draft,
          })
            .then(() => setDraft(''))
            .catch((error: unknown) => {
              if (error instanceof ApiFailure) setAnnouncement(refusalCopy(error));
            });
        }}
      >
        Send
      </button>
    </section>
  );

  const railContents = (withChat: boolean): ReactNode => (
    <>
      {partySection}
      {inspectorSection}
      {withChat ? chatSection : null}
      <SoundToggle />
    </>
  );

  const showRail = fullScreen ? railOverlay : band !== 'small' && !railCollapsed;

  return (
    <div className="page" id="world-root" ref={root} onKeyDown={onWorldKey}>
      <div className="world-strip">
        <h1>{record?.name ?? ''}</h1>
        <p role="status" aria-label="Weather" className="status-word">
          {weather === null ? '' : weather.weather.toUpperCase()}
        </p>
        <span role="group" aria-label="Coin balance" className="coins mono">
          <span ref={coinCounter}>{shownBalance}</span>
        </span>
        <button type="button" onClick={() => setInventoryOpen(true)}>
          Inventory
        </button>
        <button type="button" onClick={() => setOfferOpen(true)}>
          Offer a trade
        </button>
        {trade !== null ? (
          <button type="button" onClick={() => setTrade(trade)}>
            {`Open trade with ${
              trade.sides.find((side) => side.character_id !== activeId)?.name ?? ''
            }`}
          </button>
        ) : null}
        <button
          type="button"
          ref={fullScreenButton}
          aria-pressed={fullScreen}
          onClick={toggleFullScreen}
        >
          {fullScreen ? 'Exit full screen' : 'Full screen'}
        </button>
        <button
          type="button"
          onClick={() => {
            setAnnouncement(COPY.saving);
            void post(`/api/servers/${slug}/worlds/${world}/saves`, {})
              .then(() => setAnnouncement(COPY.saved))
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) {
                  setAnnouncement(
                    error.code === 'storage_unavailable' ? COPY.saveNotWritten : refusalCopy(error),
                  );
                }
              });
          }}
        >
          Save world
        </button>
      </div>

      <div className={showRail ? 'world-body' : 'world-body no-rail'}>
        <div className="map-frame" ref={mapHost}>
          <div
            className="map-grid"
            role="grid"
            aria-label="World map"
            onKeyDown={(event) => {
              if (grid.onKeyDown(event)) {
                event.preventDefault();
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                if (parking !== null) {
                  void park(cursorTile.x, cursorTile.y);
                } else if (myVehicle !== null) {
                  setVehicleMenuFor(myVehicle.id);
                } else {
                  inspectorFirst.current?.focus();
                }
              }
            }}
          >
            {Array.from({ length: WORLD_HEIGHT }, (_, y) =>
              Array.from({ length: WORLD_WIDTH }, (_, x) => {
                const isCursor = cursorTile.x === x && cursorTile.y === y;
                const block = blockAt(x, y);
                const vehicle = vehicleAt(x, y);
                const here = charactersAt(x, y);
                const wanted: TileCode | null =
                  parking === null ? null : parking.kind === 'car' ? '=' : '#';
                const parkTarget =
                  wanted !== null && tileAt(x, y) === wanted && vehicle === null;
                return (
                  <div
                    key={`${x}-${y}`}
                    role="gridcell"
                    data-tile={`${x}-${y}`}
                    aria-label={cellName(x, y)}
                    tabIndex={isCursor ? 0 : -1}
                    ref={(node) => grid.register(x, y, node)}
                    className={[
                      'tile',
                      `tile-${tileAt(x, y)}`,
                      isCursor ? 'cursor' : '',
                      parkTarget ? 'park-target' : '',
                    ]
                      .filter((part) => part !== '')
                      .join(' ')}
                    onClick={() => {
                      grid.focusCell(x, y);
                      if (parking !== null) void park(x, y);
                    }}
                  >
                    <TileArt code={tileAt(x, y)} />
                    {block !== null ? (
                      <span className={`block ${block.material}`} aria-hidden="true" />
                    ) : null}
                    {vehicle !== null ? (
                      <span
                        className="token"
                        data-vehicle={vehicle.id}
                        aria-hidden="true"
                      >
                        {vehicle.kind === 'car' ? '\u25AC' : '\u25B2'}
                      </span>
                    ) : null}
                    {here.map((character) => (
                      <span key={character.id} className="token" aria-hidden="true">
                        {character.name.slice(0, 2)}
                      </span>
                    ))}
                  </div>
                );
              }),
            )}
            <div className="night-overlay" ref={nightLayer} aria-hidden="true" />
          </div>
        </div>

        {showRail ? (
          <aside className="rail" role="complementary" aria-label="World rail">
            {band === 'medium' && !fullScreen ? (
              <>
                <button type="button" onClick={() => setRailCollapsed(true)}>
                  Collapse rail
                </button>
                {railContents(false)}
                <button type="button" onClick={() => setChatShown((shown) => !shown)}>
                  {chatShown ? 'Hide chat' : 'Show chat'}
                </button>
                {chatShown ? chatSection : null}
              </>
            ) : (
              railContents(fullScreen ? fullScreenChat : true)
            )}
          </aside>
        ) : null}

        {band === 'medium' && railCollapsed && !fullScreen ? (
          <button type="button" onClick={() => setRailCollapsed(false)}>
            Expand rail
          </button>
        ) : null}
      </div>

      {band === 'small' && !fullScreen ? (
        <>
          <button
            type="button"
            className="drawer-handle"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {drawerOpen ? 'Close drawer' : 'Open drawer'}
          </button>
          {drawerOpen ? (
            <div className="drawer" role="region" aria-label="Drawer">
              {railContents(true)}
            </div>
          ) : null}
        </>
      ) : null}

      <Status name="World announcements" text={announcement} />
      <Status name="Achievements" text={achievement} />
      {achievement !== '' ? <div className="toast">{achievement}</div> : null}

      {vehicleMenuFor !== null && myVehicle !== null ? (
        <div
          role="menu"
          aria-label={myVehicle.name}
          ref={vehicleMenu}
          className="card"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setVehicleMenuFor(null);
              grid.focusCell(myVehicle.x, myVehicle.y);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              startParking(myVehicle);
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => startParking(myVehicle)}
          >
            Move
          </button>
        </div>
      ) : null}

      {inventoryOpen && active !== null ? (
        <InventoryDialog
          character={active}
          onClose={() => setInventoryOpen(false)}
          onChanged={() => void reloadCharacters()}
        />
      ) : null}

      {offerOpen && active !== null ? (
        <OfferTradeDialog
          slug={slug}
          character={active}
          partners={(record?.characters ?? [])
            .filter((entry) => entry.id !== active.id)
            .map((entry) => ({ id: entry.id, name: entry.name }))}
          onClose={() => setOfferOpen(false)}
          onOpened={(opened) => {
            setOfferOpen(false);
            setTrade(opened);
          }}
        />
      ) : null}

      {trade !== null && active !== null ? (
        <TradeDialog
          trade={trade}
          character={active}
          partnerName={
            trade.sides.find((side) => side.character_id !== active.id)?.name ?? ''
          }
          onClose={() => setTrade(null)}
          onChanged={(next) => {
            setTrade(next.state === 'open' ? next : null);
            void reloadCharacters();
          }}
        />
      ) : null}

      {table !== null ? (
        <TablePanel
          table={table}
          character={active}
          tileRect={
            mapHost.current
              ?.querySelector(`[data-tile="${table.x}-${table.y}"]`)
              ?.getBoundingClientRect() ?? null
          }
          onClose={(stoodUp) => {
            setTable(null);
            go(`/s/${slug}/w/${world}`);
            if (stoodUp) setAnnouncement(copy.stoodUp(table.name));
            grid.focusCell(table.x, table.y);
          }}
          onSettled={() => void reloadCharacters()}
        />
      ) : null}
    </div>
  );
}

const refusalCopy = (error: ApiFailure): string => {
  switch (error.code) {
    case 'server_suspended':
      return COPY.refusalSuspended;
    case 'server_inactive':
      return COPY.refusalInactive;
    case 'too_far':
      return COPY.tooFar;
    case 'not_buildable':
      return COPY.notBuildable;
    case 'tile_taken':
      return COPY.tileTaken;
    case 'no_block':
      return COPY.noBlock;
    case 'inventory_full':
      return COPY.inventoryFull;
    case 'blocked':
      return COPY.blocked;
    default:
      return Object.values(error.fields).join(' ') || error.message;
  }
};

const parkRefusal = (error: ApiFailure, kind: 'car' | 'plane'): string => {
  switch (error.code) {
    case 'wrong_surface':
      return kind === 'car' ? COPY.carWrongSurface : COPY.planeWrongSurface;
    case 'no_route':
      return COPY.noRoute;
    case 'weather_grounded':
      return COPY.weatherGrounded;
    case 'tile_taken':
      return COPY.tileTaken;
    default:
      return refusalCopy(error);
  }
};

/** Tile art drawn as simple flat shapes. */
function TileArt({ code }: { code: TileCode }): ReactNode {
  if (code === '~') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true" className="art">
        <path d="M0 10 q8 -4 16 0 t16 0" stroke="#2f5d6b" fill="none" strokeWidth="2" />
        <path d="M0 20 q8 -4 16 0 t16 0" stroke="#2f5d6b" fill="none" strokeWidth="2" />
      </svg>
    );
  }
  if (code === '=') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true" className="art">
        <rect width="32" height="32" fill="#8d8f8a" />
        <path d="M16 2 v8 M16 14 v8 M16 26 v6" stroke="#f6f2e8" strokeWidth="2" />
      </svg>
    );
  }
  if (code === '#') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true" className="art">
        <rect width="32" height="32" fill="#cfcbbd" />
        <path d="M4 4 h4 M4 10 h4 M4 16 h4 M24 4 h4 M24 10 h4 M24 16 h4" stroke="#14180f" strokeWidth="2" />
      </svg>
    );
  }
  if (code === 's') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true" className="art">
        <rect width="32" height="32" fill="#e5d7ac" />
        <circle cx="8" cy="9" r="1.5" fill="#9c8a56" />
        <circle cx="20" cy="15" r="1.5" fill="#9c8a56" />
        <circle cx="12" cy="24" r="1.5" fill="#9c8a56" />
      </svg>
    );
  }
  if (code === 'T') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true" className="art">
        <rect x="1" y="1" width="30" height="30" fill="#14402c" stroke="#14180f" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="art">
      <rect width="32" height="32" fill="#e7e8d4" />
      <path d="M6 24 v-5 M14 27 v-5 M23 23 v-5" stroke="#6c7a52" strokeWidth="2" />
    </svg>
  );
}
