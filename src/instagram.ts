// Thin client over the Instagram Graph API (Instagram-Login flow), scoped to
// publishing and messaging. Token handling lives in secrets.ts — this file
// never refreshes or stores a token, it only calls with whatever it's given.

export const GRAPH = "https://graph.instagram.com";
export const VERSION = "v21.0";
const FETCH_TIMEOUT_MS = 15_000;

export class InstagramApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
}

/** Replaces a token wherever it appears in a string — for anything that might get logged or thrown. */
export function mask(text: string, token?: string): string {
  let out = token && token.length >= 4 ? text.split(token).join("***") : text;
  return out.replace(/access_token=[^&\s"']+/g, "access_token=***");
}

async function call(
  path: string,
  token: string,
  init: { method?: "GET" | "POST"; params?: Record<string, string | undefined> } = {},
): Promise<unknown> {
  const url = new URL(`${GRAPH}/${VERSION}${path}`);
  for (const [k, v] of Object.entries(init.params ?? {})) if (v !== undefined) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method: init.method ?? "GET", signal: ctl.signal });
  } catch (err) {
    throw new Error(mask(`Instagram API request failed: ${(err as Error).message}`, token));
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
    throw new InstagramApiError(mask(`Instagram API error: ${msg}`, token), res.status, body);
  }
  return body;
}

// ---- Content publishing (container model: create, poll, publish) ----

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

/** Step 1 of publishing a single image post. Returns the new container's id. */
export async function createImageContainer(igUserId: string, token: string, opts: { imageUrl: string; caption?: string }): Promise<string> {
  const body = (await call(`/${igUserId}/media`, token, {
    method: "POST",
    params: { image_url: opts.imageUrl, caption: opts.caption },
  })) as { id?: string };
  if (!body.id) throw new Error("Instagram did not return a container id for the image");
  return body.id;
}

/** Step 1 of publishing a Reel. Returns the new container's id. Video must finish processing before it can be published — see waitForContainer. */
export async function createReelContainer(igUserId: string, token: string, opts: { videoUrl: string; caption?: string }): Promise<string> {
  const body = (await call(`/${igUserId}/media`, token, {
    method: "POST",
    params: { media_type: "REELS", video_url: opts.videoUrl, caption: opts.caption },
  })) as { id?: string };
  if (!body.id) throw new Error("Instagram did not return a container id for the reel");
  return body.id;
}

/** Current processing status of a media container. */
export async function getContainerStatus(containerId: string, token: string): Promise<ContainerStatus> {
  const body = (await call(`/${containerId}`, token, { params: { fields: "status_code" } })) as { status_code?: string };
  return (body.status_code as ContainerStatus) ?? "IN_PROGRESS";
}

/**
 * Poll a container until it's FINISHED (ready to publish) or we give up.
 * Images are usually instant; Reels can take anywhere from seconds to a few minutes.
 */
export async function waitForContainer(containerId: string, token: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getContainerStatus(containerId, token);
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`Container ${containerId} ended in status ${status}`);
    if (Date.now() >= deadline) throw new Error(`Container ${containerId} did not finish processing within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Step 2: publish a container that's already FINISHED. Returns the new media id. */
export async function publishContainer(igUserId: string, containerId: string, token: string): Promise<string> {
  const body = (await call(`/${igUserId}/media_publish`, token, {
    method: "POST",
    params: { creation_id: containerId },
  })) as { id?: string };
  if (!body.id) throw new Error("Instagram did not return a media id on publish");
  return body.id;
}

/** How many of today's publishing quota this account has used (Meta caps posts/Reels per rolling 24h). */
export async function getPublishingLimit(igUserId: string, token: string): Promise<{ quotaUsage: number; config: { quotaTotal: number; quotaDuration: number } } | null> {
  const body = (await call(`/${igUserId}/content_publishing_limit`, token)) as {
    data?: { quota_usage: number; config: { quota_total: number; quota_duration: number } }[];
  };
  const row = body.data?.[0];
  if (!row) return null;
  return { quotaUsage: row.quota_usage, config: { quotaTotal: row.config.quota_total, quotaDuration: row.config.quota_duration } };
}

// ---- Messaging ----

/** Send a freeform text DM to someone who has already messaged this account (their IGSID, from a webhook). */
export async function sendTextMessage(igUserId: string, token: string, recipientIgsid: string, text: string): Promise<void> {
  await call(`/${igUserId}/messages`, token, {
    method: "POST",
    params: { recipient: JSON.stringify({ id: recipientIgsid }), message: JSON.stringify({ text }) },
  });
}

// ---- Comments ----

/** Public reply to a comment on one of this account's posts. */
export async function replyToComment(commentId: string, token: string, message: string): Promise<string> {
  const body = (await call(`/${commentId}/replies`, token, { method: "POST", params: { message } })) as { id?: string };
  if (!body.id) throw new Error("Instagram did not return a reply id");
  return body.id;
}
