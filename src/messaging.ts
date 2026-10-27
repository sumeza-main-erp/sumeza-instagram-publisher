// High-level helpers for DMs and comment replies — same token-from-Secret-Manager
// pattern as publish.ts.

import { getInstagramToken } from "./secrets.js";
import { sendTextMessage, replyToComment } from "./instagram.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Send a text DM to someone who has already messaged this account (recipientIgsid comes from a webhook). */
export async function sendDirectMessage(recipientIgsid: string, text: string): Promise<void> {
  const token = await getInstagramToken();
  const igUserId = requireEnv("IG_BUSINESS_ACCOUNT_ID");
  await sendTextMessage(igUserId, token, recipientIgsid, text);
}

/** Public reply under a comment on one of this account's posts. */
export async function replyToPostComment(commentId: string, message: string): Promise<string> {
  const token = await getInstagramToken();
  return replyToComment(commentId, token, message);
}
