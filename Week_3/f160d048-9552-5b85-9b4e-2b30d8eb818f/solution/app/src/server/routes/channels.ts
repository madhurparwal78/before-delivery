import { first, rows } from "../db/pool";
import { inUnit } from "../db/unit";
import { findContactDetail } from "../domain/contact";
import { ApiError, invalidFields, refuse } from "../http/fail";
import { defineRoute, requireJsonObject, type Ctx, type Handler } from "../http/route";
import { viewChannelPosts, type ChannelPostRow } from "../services/channelView";
import { channelPostShape, parseShape } from "../../shared/rules";

type ChannelRecord = { id: string; slug: string; name: string };

async function loadChannel(ctx: Ctx): Promise<ChannelRecord> {
  const channel = await first<ChannelRecord>("SELECT id, slug, name FROM channels WHERE slug = $1", [ctx.params["slug"]]);
  if (!channel) throw refuse("not_found");
  return channel;
}

const list = defineRoute({
  method: "GET",
  path: "/api/channels",
  auth: "session",
  roles: ["member"],
  async run() {
    const channels = await rows<{ slug: string; name: string }>("SELECT slug, name FROM channels ORDER BY name");
    return { status: 200, body: { channels } };
  },
});

const posts = defineRoute({
  method: "GET",
  path: "/api/channels/:slug/posts",
  auth: "session",
  roles: ["member"],
  load: loadChannel,
  async run(_ctx, channel) {
    const found = await rows<ChannelPostRow>(
      `SELECT id, $2::text AS channel_slug, body, created_at FROM channel_posts WHERE channel_id = $1 ORDER BY created_at, id`,
      [channel.id, channel.slug],
    );
    return { status: 200, body: { posts: await viewChannelPosts(found) } };
  },
});

const post = defineRoute({
  method: "POST",
  path: "/api/channels/:slug/posts",
  auth: "session",
  roles: ["member"],
  body: "json",
  load: loadChannel,
  input(ctx) {
    const parsed = parseShape(channelPostShape, requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    const finding = findContactDetail([["body", parsed.value.body]]);
    if (finding) throw new ApiError(finding.code, {}, { field: finding.field });
    return parsed.value;
  },
  async run(ctx, channel, input) {
    const created = await inUnit(async (unit) => {
      const inserted = await unit.first<ChannelPostRow>(
        `INSERT INTO channel_posts (channel_id, author_id, body, created_at) VALUES ($1, $2, $3, app_now())
         RETURNING id, $4::text AS channel_slug, body, created_at`,
        [channel.id, ctx.viewer?.id, input.body, channel.slug],
      );
      if (!inserted) throw refuse("not_found");
      const [view] = await viewChannelPosts([inserted]);
      unit.emit({ type: "channel.post", audience: ["members"], data: { channel_slug: channel.slug, post: view } });
      return view;
    });
    return { status: 201, body: created };
  },
});

export const channelRoutes: Handler[] = [list, posts, post];
