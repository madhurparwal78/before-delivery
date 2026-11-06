import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as copy from '../../shared/copy.js';
import { COPY } from '../../shared/copy.js';
import {
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
}

export function WorldPage({ slug, world, tableId }: Props): ReactNode {
  const { go } = useRouter();
  const band = useWidthBand();

  const { activeId, active, reload: reloadCharacters } = useRoster();
  const [record, setRecord] = useState<WorldObject | null>(null);
  const [drive, setDrive] = useState<{ id: string; x: number; y: number } | null>(null);
  const [driven, setDriven] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [achievement, setAchievement] = useState('');
  const [material, setMaterial] = useState<Material>('wood');
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
  /* The newest record of the open trade, and whether its window is open; the
     window stays open after the trade closes so its last status can be read. */
  const [trade, setTrade] = useState<TradeObject | null>(null);
  const [tradeWindow, setTradeWindow] = useState(false);
  const announcedTrades = useRef(new Set<string>());
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
      /* Settlements, trades and purchases move the active character's coins. */
      void reloadCharacters();
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
      setTrade((current) =>
        next.state === 'open' || (current?.id === next.id && tradeWindow) ? next : current?.id === next.id ? null : current,
      );
      const opener = next.sides[0];
      if (
        next.state === 'open' &&
        opener !== undefined &&
        opener.character_id !== activeId &&
        !announcedTrades.current.has(next.id)
      ) {
        announcedTrades.current.add(next.id);
        setAnnouncement(copy.tradeOffered(opener.name));
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
  /* A driving vehicle's sprite stays on its start tile until its drive has played. */
  const spriteAt = (x: number, y: number) =>
    record?.vehicles.find((vehicle) =>
      drive !== null && drive.id === vehicle.id
        ? drive.x === x && drive.y === y
        : vehicle.x === x && vehicle.y === y,
    ) ?? null;
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

  /* Steps are sent one at a time, in the order the keys were pressed, so the
     last announcement is always the last step's. */
  const walkQueue = useRef<Promise<void>>(Promise.resolve());
  const walk = (direction: 'north' | 'east' | 'south' | 'west'): void => {
    walkQueue.current = walkQueue.current.then(() => walkOnce(direction));
  };

  const walkOnce = async (direction: 'north' | 'east' | 'south' | 'west'): Promise<void> => {
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

  const startParking = (vehicle: {
    id: string;
    name: string;
    kind: 'car' | 'plane';
    x: number;
    y: number;
  }): void => {
    setParking(vehicle);
    setVehicleMenuFor(null);
    setAnnouncement(copy.parkingPrompt(vehicle.name, vehicle.kind === 'car' ? 'road' : 'runway'));
    if (band === 'small') setDrawerOpen(false);
    /* The cursor starts parking mode on the vehicle's own tile. */
    grid.focusCell(vehicle.x, vehicle.y);
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
    const start = record?.vehicles.find((entry) => entry.id === vehicle.id);
    if (start !== undefined) setDrive({ id: vehicle.id, x: start.x, y: start.y });
    try {
      const answer = await post<{
        announcement: string;
        trip: { steps: string[] };
      }>(`/api/vehicles/${vehicle.id}/park`, { x, y });
      setParking(null);
      setAnnouncement(answer.announcement);
      const sprite =
        mapHost.current?.querySelector<HTMLElement>(`[data-vehicle="${vehicle.id}"]`) ?? null;
      await driveVehicle(sprite, answer.trip.steps, band === 'small' ? 44 : 32);
      setDriven(vehicle.id);
      await reloadWorld();
    } catch (error) {
      if (error instanceof ApiFailure) setAnnouncement(parkRefusal(error, vehicle.kind));
    } finally {
      setDrive(null);
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

  const [seatPending, setSeatPending] = useState<'seat' | 'watch' | null>(null);
  /* The panel grows out of its tile only after a confirmed seat or watch. */
  const [drawIn, setDrawIn] = useState(false);
  const [focusWatch, setFocusWatch] = useState(false);
  useEffect(() => {
    if (!focusWatch || seatPending !== null) return;
    setFocusWatch(false);
    watchButton.current?.focus();
  }, [focusWatch, seatPending]);

  const takeSeat = async (entry: { id: string }, watching: boolean): Promise<void> => {
    if (active === null || seatPending !== null) return;
    setSeatPending(watching ? 'watch' : 'seat');
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
      setDrawIn(true);
      go(`/s/${slug}/w/${world}/t/${entry.id}`);
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === 'table_full') {
          setAnnouncement(COPY.tableFull);
          setFocusWatch(true);
        } else {
          setAnnouncement(refusalCopy(error));
        }
      }
    } finally {
      setSeatPending(null);
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
      walk(direction);
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
              walk(direction);
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
            <button
              type="button"
              disabled={seatPending !== null}
              onClick={() => void takeSeat(cursorTable, false)}
            >
              {seatPending === 'seat' ? 'Taking seat' : 'Take seat'}
            </button>
            <button
              type="button"
              ref={watchButton}
              disabled={seatPending !== null}
              onClick={() => void takeSeat(cursorTable, true)}
            >
              {seatPending === 'watch' ? 'Joining' : 'Watch'}
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
        {trade !== null && trade.state === 'open' ? (
          <button type="button" onClick={() => setTradeWindow(true)}>
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
            {Array.from({ length: WORLD_HEIGHT }, (_, y) => (
              <div role="row" className="grid-row" key={y}>
              {Array.from({ length: WORLD_WIDTH }, (_, x) => {
                const isCursor = cursorTile.x === x && cursorTile.y === y;
                const block = blockAt(x, y);
                const vehicle = vehicleAt(x, y);
                const sprite = spriteAt(x, y);
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
              onFocus={() => grid.setCursor({ x, y })}
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
                    <TileArt
                      code={tileAt(x, y)}
                      x={x}
                      y={y}
                      roadAcross={tileAt(x - 1, y) === '=' || tileAt(x + 1, y) === '='}
                      game={tableAt(x, y)?.game ?? null}
                    />
                    {block !== null ? (
                      <span className={`block ${block.material}`} aria-hidden="true" />
                    ) : null}
                    {sprite !== null ? (
                      <span
                        className="token"
                        data-vehicle={sprite.id}
                        {...(sprite.id === driven ? { 'data-anim': 'vehicle-drive', 'data-phase': 'end' } : {})}
                        aria-hidden="true"
                      >
                        <VehicleArt kind={sprite.kind} />
                      </span>
                    ) : null}
                    {here.map((character) => (
                      <span
                        key={character.id}
                        className="token"
                        data-initials={character.name.slice(0, 2)}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                );
              })}
              </div>
            ))}
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
              railContents(!fullScreen)
            )}
          </aside>
        ) : null}

        {fullScreen && fullScreenChat ? <div className="chat-overlay">{chatSection}</div> : null}

        {band === 'medium' && railCollapsed && !fullScreen ? (
          <button type="button" onClick={() => setRailCollapsed(false)}>
            Expand rail
          </button>
        ) : null}
      </div>

      {band === 'small' && !fullScreen ? (
        drawerOpen ? (
          <div className="drawer" role="region" aria-label="Drawer">
            <button type="button" className="drawer-handle" onClick={() => setDrawerOpen(false)}>
              Close drawer
            </button>
            <div className="drawer-body">{railContents(true)}</div>
          </div>
        ) : (
          <button type="button" className="drawer-handle" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </button>
        )
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
            announcedTrades.current.add(opened.id);
            setTrade(opened);
            setTradeWindow(true);
          }}
        />
      ) : null}

      {tradeWindow && trade !== null && active !== null ? (
        <TradeDialog
          trade={trade}
          character={active}
          partnerName={
            trade.sides.find((side) => side.character_id !== active.id)?.name ?? ''
          }
          onClose={() => {
            setTradeWindow(false);
            if (trade.state !== 'open') setTrade(null);
          }}
          onChanged={(next) => {
            setTrade(next);
            void reloadCharacters();
          }}
        />
      ) : null}

      {table !== null ? (
        <TablePanel
          table={table}
          character={active}
          tileRect={() =>
            mapHost.current
              ?.querySelector(`[data-tile="${table.x}-${table.y}"]`)
              ?.getBoundingClientRect() ?? null
          }
          drawIn={drawIn}
          onClose={(stoodUp) => {
            setDrawIn(false);
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

/* Tile art, drawn as simple flat shapes on a 32-unit square. */

const INK = '#161b12';
const PAPER = '#f5f0e3';

/** Grass: a paper tint with a few ink ticks, varied tile to tile. */
const TICKS: readonly string[] = [
  'M6 24v-4M8 25v-3M21 12v-4M23 13v-3M14 29v-3',
  'M10 9v-4M12 10v-3M24 24v-4M26 25v-3M4 17v-3',
  'M17 20v-4M19 21v-3M5 8v-3M27 6v-3M9 29v-3',
];

function TileArt({
  code,
  x,
  y,
  roadAcross,
  game,
}: {
  code: TileCode;
  x: number;
  y: number;
  /** For a road tile: true when the road runs east-west. */
  roadAcross: boolean;
  /** For a table tile: its game, drawn as a small mark on the felt. */
  game: 'chess' | 'four' | 'tricks' | null;
}): ReactNode {
  const art = (body: ReactNode): ReactNode => (
    <svg viewBox="0 0 32 32" preserveAspectRatio="none" aria-hidden="true" className="art">
      {body}
    </svg>
  );
  switch (code) {
    case '~':
      return art(
        <>
          <rect width="32" height="32" fill="#c8dad5" />
          <path
            d={y % 2 === 0 ? 'M0 10q4-3 8 0t8 0 8 0 8 0M0 22q4-3 8 0t8 0 8 0 8 0' : 'M-4 14q4-3 8 0t8 0 8 0 8 0 8 0M-4 26q4-3 8 0t8 0 8 0 8 0 8 0'}
            stroke="#2d5866"
            strokeWidth="1.6"
            fill="none"
          />
        </>,
      );
    case '=':
      return art(
        <>
          <rect width="32" height="32" fill="#e4e1cc" />
          {roadAcross ? (
            <>
              <rect y="5" width="32" height="22" fill="#8d908a" />
              <path d="M0 5.5h32M0 26.5h32" stroke={INK} strokeWidth="1" />
              <path d="M3 16h10M19 16h10" stroke={PAPER} strokeWidth="2" />
            </>
          ) : (
            <>
              <rect x="5" width="22" height="32" fill="#8d908a" />
              <path d="M5.5 0v32M26.5 0v32" stroke={INK} strokeWidth="1" />
              <path d="M16 3v10M16 19v10" stroke={PAPER} strokeWidth="2" />
            </>
          )}
        </>,
      );
    case '#':
      return art(
        <>
          <rect width="32" height="32" fill="#e4e1cc" />
          <rect y="4" width="32" height="24" fill="#d8d3bf" />
          <path d="M0 4.5h32M0 27.5h32" stroke={INK} strokeWidth="1" />
          {x % 2 === 0 ? (
            <path d="M6 9v14M10 9v14M14 9v14" stroke={INK} strokeWidth="1.6" />
          ) : (
            <path d="M8 16h16" stroke={INK} strokeWidth="1.4" strokeDasharray="4 3" />
          )}
        </>,
      );
    case 's':
      return art(
        <>
          <rect width="32" height="32" fill="#ead9a8" />
          <g fill="#8f7a45">
            <circle cx={7 + (x % 3) * 2} cy="8" r="1.1" />
            <circle cx="20" cy={13 + (y % 3)} r="1.1" />
            <circle cx="11" cy="23" r="1.1" />
            <circle cx="26" cy="26" r="1.1" />
            <circle cx="26" cy="5" r="0.9" />
          </g>
        </>,
      );
    case 'T':
      return art(
        <>
          <rect x="1" y="1" width="30" height="30" fill="#1e5a3f" stroke={INK} strokeWidth="2" />
          <rect x="5" y="5" width="22" height="22" fill="none" stroke={PAPER} strokeOpacity="0.35" />
          {game === 'chess' ? (
            <path
              d="M12 23h8l-1.5-3h-5zM14 20l-1-6h6l-1 6M13.5 14l2.5-4 2.5 4"
              fill={PAPER}
              stroke={PAPER}
              strokeWidth="0.8"
              strokeLinejoin="round"
            />
          ) : game === 'four' ? (
            <g fill={PAPER}>
              <circle cx="12" cy="13" r="2.6" />
              <circle cx="20" cy="13" r="2.6" fillOpacity="0.55" />
              <circle cx="12" cy="20" r="2.6" fillOpacity="0.55" />
              <circle cx="20" cy="20" r="2.6" />
            </g>
          ) : (
            <g stroke={INK} strokeWidth="0.8">
              <rect x="10" y="10" width="8" height="11" rx="1" fill={PAPER} transform="rotate(-10 14 15)" />
              <rect x="14" y="11" width="8" height="11" rx="1" fill={PAPER} transform="rotate(10 18 16)" />
            </g>
          )}
        </>,
      );
    default:
      return art(
        <>
          <rect width="32" height="32" fill="#e6e8cf" />
          <path d={TICKS[(x * 7 + y * 3) % TICKS.length]} stroke="#55613f" strokeWidth="1.2" />
        </>,
      );
  }
}

/** Vehicles, as top-down silhouettes in ink with paper highlights. */
function VehicleArt({ kind }: { kind: 'car' | 'plane' }): ReactNode {
  return kind === 'car' ? (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="5" y="9" width="22" height="14" rx="4" fill={INK} />
      <rect x="15" y="11" width="6" height="10" rx="1.5" fill={PAPER} fillOpacity="0.85" />
      <rect x="8" y="11.5" width="4" height="9" rx="1" fill={PAPER} fillOpacity="0.5" />
      <path d="M8 8h4M20 8h4M8 24h4M20 24h4" stroke={INK} strokeWidth="2" />
    </svg>
  ) : (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 3c1.6 0 2.2 2 2.2 5v5l10 5v3l-10-2.5V25l3.5 2.5V30L16 28.6 10.3 30v-2.5L13.8 25v-6.5L3.8 21v-3l10-5V8c0-3 .6-5 2.2-5z"
        fill={INK}
        stroke={PAPER}
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
