# Sumeza Instagram Publisher

Standalone service for publishing posts/Reels and sending DMs/comment replies
to Sumeza's Instagram Business account via the Instagram Graph API
(Instagram-Login flow, `graph.instagram.com`).

This is intentionally separate from `sumeza-erp-admin` — no shared code, no
shared deploy pipeline, nothing that touches ERP/website work in progress
elsewhere. The two repos share exactly one thing on purpose: the Instagram
access token in GCP Secret Manager.

## How the token is handled

- This service is **read-only** against Secret Manager. It fetches the
  latest version of `IG_TOKEN_SECRET_NAME` and caches it in memory for 5
  minutes, then re-fetches.
- It **never** calls Instagram's `refresh_access_token` and never writes a
  new secret version. Token refresh stays the ERP backend's job
  (`backend/src/lib/instagram.ts`), so the two never race over the same
  token.

**Open item, not handled by this repo:** the ERP backend currently refreshes
the token and caches the rotated value in its own Postgres `system_settings`
table — it does not write the refreshed token back to Secret Manager. That
means Secret Manager's copy can go stale once the ERP has rotated past it
(tokens are valid 60 days; the ERP refreshes proactively around day 7-ish of
the token's age). For this service to always see a current token, something
needs to also persist each refresh back into
`IG_TOKEN_SECRET_NAME` in Secret Manager. That's a small change on the ERP
side — flagging it here rather than making it, since that repo's in active
use elsewhere right now.

## Setup

```bash
npm install
cp .env.example .env   # fill in GCP_PROJECT_ID, IG_TOKEN_SECRET_NAME, IG_BUSINESS_ACCOUNT_ID
```

`IG_BUSINESS_ACCOUNT_ID` is the Instagram professional account id (the
"IG_ID" in Meta's docs) — the same account the website reels embed already
points at. `IG_TOKEN_SECRET_NAME` is the Secret Manager secret id, also the
same one the website already reads.

Authentication to GCP uses Application Default Credentials — same as any
other `@google-cloud/*` client. Locally: `gcloud auth application-default
login`. In Cloud Run/Functions/wherever this ends up deployed: the
service's own identity, granted `secretmanager.secretAccessor` on that one
secret.

## Usage

```bash
# Test a real publish
npm run post -- --image https://example.com/pic.jpg --caption "Hello"
npm run reel -- --video https://example.com/clip.mp4 --caption "Hello"

# Check today's publishing quota before posting
npm run build && node dist/cli.js quota
```

From code:

```ts
import { publishImagePost, publishReel } from "./src/publish.js";
import { sendDirectMessage, replyToPostComment } from "./src/messaging.js";

await publishImagePost({ imageUrl, caption });
await publishReel({ videoUrl, caption });
await sendDirectMessage(recipientIgsid, "Thanks for reaching out!");
await replyToPostComment(commentId, "Glad you liked it!");
```

## Notes

- `imageUrl` / `videoUrl` must be publicly reachable over HTTPS — Meta's
  servers fetch the file themselves at publish time.
- Reels: H.264 video codec, AAC audio, 3 seconds to 15 minutes, aspect ratio
  between 0.01:1 and 10:1. Processing can take anywhere from a few seconds
  to a couple of minutes; `waitForContainer` polls until it's ready.
- Meta caps publishing at roughly 25 feed posts and 25 Reels per rolling
  24 hours, 50 Stories. `checkPublishingQuota()` / `npm run ... quota`
  reports current usage.
- DMs only work with someone who has already messaged this account first
  (their IGSID comes from a webhook, not something you can look up ahead of
  time) — and Meta requires a human-agent escalation path for anything
  using the messaging permission, so this is meant as a building block, not
  a fully automated bot on its own.
