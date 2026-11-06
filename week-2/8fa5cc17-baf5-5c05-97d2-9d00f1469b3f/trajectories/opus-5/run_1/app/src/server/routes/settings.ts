import { Reply, RequestContext, Route, json, route, validationError } from '../http/core';
import { commitWithEvents, loadSettings, saveSettings } from '../domain/commit';
import { LiveEvent } from '../events';
import { isTimeZone } from '../../shared/homeclock';
import { isThemeName } from '../../shared/tokens';

const SETTINGS_MESSAGES = {
  zone: 'Choose a time zone from the list.',
  theme: 'Choose Paper or Lamplight.',
} as const;

export const settingsRoutes: Route[] = [
  route('GET', '/api/settings', async (): Promise<Reply> => {
    const settings = await loadSettings();
    return json({ home_time_zone: settings.homeTimeZone, theme: settings.theme });
  }),

  route('PUT', '/api/settings', async (context: RequestContext): Promise<Reply> => {
    const body =
      context.json === null || typeof context.json !== 'object' ? {} : (context.json as Record<string, unknown>);
    const wantsZone = body['home_time_zone'] !== undefined;
    const wantsTheme = body['theme'] !== undefined;
    if (!wantsZone && !wantsTheme) throw validationError({ theme: SETTINGS_MESSAGES.theme });
    const errors: Record<string, string> = {};
    if (wantsZone && !isTimeZone(body['home_time_zone'])) errors['home_time_zone'] = SETTINGS_MESSAGES.zone;
    if (wantsTheme && !isThemeName(body['theme'])) errors['theme'] = SETTINGS_MESSAGES.theme;
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const next = await saveSettings({
      homeTimeZone: wantsZone ? (body['home_time_zone'] as string) : undefined,
      theme: wantsTheme && isThemeName(body['theme']) ? body['theme'] : undefined,
    });
    await commitWithEvents(async () => ({
      result: null,
      events: [
        {
          type: 'settings.saved',
          data: { home_time_zone: next.homeTimeZone, theme: next.theme },
        },
      ] as LiveEvent[],
    }));
    return json({ home_time_zone: next.homeTimeZone, theme: next.theme });
  }),
];
