export type ClockConfig = {
  dayTicks: number;
  duskStartHour: number;
  duskEndHour: number;
  rainStartHour: number;
  rainEndHour: number;
};

export type WorldTime = {
  tick: number;
  hour: number;
  minute: number;
  time: string;
  dusk: boolean;
  weather: 'clear' | 'rain';
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The published world clock rule: the one place a tick becomes an hour, minute, dusk and weather. */
export function worldTime(tick: number, config: ClockConfig): WorldTime {
  const day = config.dayTicks;
  const hourTicks = day / 24;
  const hour = Math.floor(((tick % day) * 24) / day);
  const minute = Math.floor(((tick % hourTicks) * 60) / hourTicks);
  const dusk = hour >= config.duskStartHour && hour < config.duskEndHour;
  const rain = hour >= config.rainStartHour && hour < config.rainEndHour;
  return { tick, hour, minute, time: `${pad(hour)}:${pad(minute)}`, dusk, weather: rain ? 'rain' : 'clear' };
}
