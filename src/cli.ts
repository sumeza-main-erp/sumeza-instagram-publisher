#!/usr/bin/env node
// Minimal command-line runner for manual testing:
//   npm run post -- --image https://example.com/pic.jpg --caption "Hello"
//   npm run reel -- --video https://example.com/clip.mp4 --caption "Hello"
//
// Not a service — just a way to confirm the publish flow actually works
// against the real account before wiring it into anything scheduled.

import { publishImagePost, publishReel, publishCarousel, checkPublishingQuota } from "./publish.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === "post") {
    const imageUrl = arg("image");
    const caption = arg("caption");
    if (!imageUrl) throw new Error("Usage: post --image <url> [--caption \"text\"]");
    console.log("Publishing image post...");
    const result = await publishImagePost({ imageUrl, caption });
    console.log("Published:", result);
    return;
  }

  if (cmd === "reel") {
    const videoUrl = arg("video");
    const caption = arg("caption");
    if (!videoUrl) throw new Error("Usage: reel --video <url> [--caption \"text\"]");
    console.log("Publishing Reel (this can take a minute or two while Instagram processes the video)...");
    const result = await publishReel({ videoUrl, caption });
    console.log("Published:", result);
    return;
  }

  if (cmd === "carousel") {
    // --images takes a comma-separated list of 2-10 publicly reachable image URLs, in slide order.
    const imagesArg = arg("images");
    const caption = arg("caption");
    if (!imagesArg) throw new Error('Usage: carousel --images "url1,url2,..." [--caption "text"]');
    const imageUrls = imagesArg.split(",").map((u) => u.trim()).filter(Boolean);
    console.log(`Publishing a ${imageUrls.length}-image carousel...`);
    const result = await publishCarousel({ imageUrls, caption });
    console.log("Published:", result);
    return;
  }

  if (cmd === "quota") {
    const quota = await checkPublishingQuota();
    console.log("Publishing quota:", quota);
    return;
  }

  console.error("Usage: node dist/cli.js <post|reel|carousel|quota> [options]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
