import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

// Read-only access to the Instagram token already stored in Secret Manager.
// This service never writes a new version here — token refresh stays the
// ERP backend's responsibility, so the two never race over the same value.

const client = new SecretManagerServiceClient();

type Cached = { value: string; at: number };
const cache = new Map<string, Cached>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — avoid hammering Secret Manager on every call

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Latest enabled version of a secret, cached in-process for a few minutes. */
export async function getSecret(secretName: string): Promise<string> {
  const hit = cache.get(secretName);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const projectId = requireEnv("GCP_PROJECT_ID");
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
  const [version] = await client.accessSecretVersion({ name });
  const value = version.payload?.data?.toString("utf8")?.trim();
  if (!value) throw new Error(`Secret Manager returned no value for ${secretName}`);

  cache.set(secretName, { value, at: Date.now() });
  return value;
}

/** The Instagram access token, read from the secret named by IG_TOKEN_SECRET_NAME. */
export async function getInstagramToken(): Promise<string> {
  return getSecret(requireEnv("IG_TOKEN_SECRET_NAME"));
}

/** Forget any cached secret values — mainly useful in tests. */
export function clearSecretCache(): void {
  cache.clear();
}
