// High-level helpers: fetch the current token from Secret Manager, then run
// the full container -> wait -> publish flow. This is what other code
// (a scheduled task, a small HTTP handler, the CLI below) should call.

import { getInstagramToken } from "./secrets.js";
import { createImageContainer, createReelContainer, createCarouselItemContainer, createCarouselContainer, publishContainer, waitForContainer, getPublishingLimit } from "./instagram.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export type PublishResult = { mediaId: string; containerId: string };

/** Publish a single image post. imageUrl must be publicly reachable (Meta fetches it server-side). */
export async function publishImagePost(opts: { imageUrl: string; caption?: string }): Promise<PublishResult> {
  const token = await getInstagramToken();
  const igUserId = requireEnv("IG_BUSINESS_ACCOUNT_ID");
  const containerId = await createImageContainer(igUserId, token, opts);
  await waitForContainer(containerId, token, { timeoutMs: 60_000 });
  const mediaId = await publishContainer(igUserId, containerId, token);
  return { mediaId, containerId };
}

/** Publish a Reel. videoUrl must be publicly reachable; H.264/AAC, 3s-15min, aspect ratio 0.01:1 to 10:1. */
export async function publishReel(opts: { videoUrl: string; caption?: string }): Promise<PublishResult> {
  const token = await getInstagramToken();
  const igUserId = requireEnv("IG_BUSINESS_ACCOUNT_ID");
  const containerId = await createReelContainer(igUserId, token, opts);
  // Video processing is slower and less predictable than an image container.
  await waitForContainer(containerId, token, { timeoutMs: 5 * 60 * 1000, intervalMs: 5_000 });
  const mediaId = await publishContainer(igUserId, containerId, token);
  return { mediaId, containerId };
}

/** Publish a carousel (2-10 images). Each image is created as a carousel-item container first, then wrapped in a parent carousel container carrying the one caption. */
export async function publishCarousel(opts: { imageUrls: string[]; caption?: string }): Promise<PublishResult> {
  const token = await getInstagramToken();
  const igUserId = requireEnv("IG_BUSINESS_ACCOUNT_ID");
  const childIds: string[] = [];
  for (const imageUrl of opts.imageUrls) {
    const id = await createCarouselItemContainer(igUserId, token, { imageUrl });
    childIds.push(id);
  }
  // Child items don't need to each reach FINISHED before building the parent container, but waiting
  // avoids a race where the parent container is created before Meta has fetched every image.
  for (const id of childIds) {
    await waitForContainer(id, token, { timeoutMs: 60_000 });
  }
  const containerId = await createCarouselContainer(igUserId, token, { childIds, caption: opts.caption });
  await waitForContainer(containerId, token, { timeoutMs: 60_000 });
  const mediaId = await publishContainer(igUserId, containerId, token);
  return { mediaId, containerId };
}

/** How much of today's publishing quota is used, so a caller can decide whether to queue instead of post. */
export async function checkPublishingQuota() {
  const token = await getInstagramToken();
  const igUserId = requireEnv("IG_BUSINESS_ACCOUNT_ID");
  return getPublishingLimit(igUserId, token);
}
