// Account actions shared by the header popover and the phone menu: the username, the `Profile time zone` select (PATCH /api/me)
// and `button "Sign out"` (DELETE /api/session, then /sign-in).
import { api, useAction } from "../api.ts";
import { announce } from "../announce.tsx";
import { parseUser } from "../config.ts";
import { navigate } from "../router.ts";
import { setUser, useUser } from "../session.ts";
import { Button } from "../ui/button.tsx";
import { Select } from "../ui/fields.tsx";
import { isRecord } from "../util.ts";

function zoneOptions(current: string): Array<{ value: string; label: string }> {
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zones = new Set<string>(["UTC", ...supported, current]);
  return [...zones].sort((a, b) => a.localeCompare(b)).map((zone) => ({ value: zone, label: zone }));
}

export function AccountPanel({ onDone }: { onDone?: () => void }) {
  const user = useUser();
  const zone = useAction(async (next: string) => {
    const body: unknown = await api.patch("/api/me", { time_zone: next });
    const updated = isRecord(body) ? parseUser(body.user) : null;
    if (updated) setUser(updated);
    announce(`Profile time zone set to ${next}.`);
  });
  const signOut = useAction(async () => {
    await api.del("/api/session");
    setUser(null);
    onDone?.();
    navigate("/sign-in");
  });
  if (!user) return null;
  return (
    <div class="sp-account-panel">
      <p class="sp-account-panel__who">
        Signed in as <strong>{user.username}</strong>
      </p>
      <Select
        label="Profile time zone"
        name="time_zone"
        id="account-time-zone"
        value={user.time_zone}
        options={zoneOptions(user.time_zone)}
        disabled={zone.pending}
        aria-busy={zone.pending ? "true" : undefined}
        onChange={(event) => void zone.run(event.currentTarget.value)}
      />
      <Button variant="secondary" pending={signOut.pending} onClick={() => void signOut.run()}>
        Sign out
      </Button>
    </div>
  );
}
