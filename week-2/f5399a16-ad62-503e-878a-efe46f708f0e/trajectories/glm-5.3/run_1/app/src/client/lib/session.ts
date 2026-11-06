// The session: signed-in screens re-read it, and a session that ends
// mid-form keeps the open dialog as typed with the published copy announced.

import { Api, ApiError } from "./state";

export class Session {
  private api = new Api();
  signedIn = false;
  endedHandler: ((ended: boolean) => void) | null = null;

  async load(): Promise<void> {
    try {
      await this.api.get("/api/session");
      this.signedIn = true;
    } catch (e) {
      this.signedIn = false;
      if (e instanceof ApiError && e.code === "session_ended") {
        this.endedHandler?.(true);
      }
    }
  }

  async signOut(): Promise<void> {
    await this.api.post("/api/sign-out", {});
    this.signedIn = false;
  }
}
