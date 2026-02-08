import createApp from "@shopify/app-bridge";
import { getSessionToken } from "@shopify/app-bridge-utils";

let appInstance: ReturnType<typeof createApp> | null = null;
let tokenPromise: Promise<string | null> | null = null;
let tokenExpiry = 0;

function getHostParam() {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get("host");
  } catch {
    return null;
  }
}

function getApiKey() {
  return import.meta.env.VITE_SHOPIFY_API_KEY as string | undefined;
}

export function getAppBridge() {
  if (appInstance) return appInstance;
  const apiKey = getApiKey();
  const host = getHostParam();
  if (!apiKey || !host) return null;
  appInstance = createApp({ apiKey, host, forceRedirect: true });
  return appInstance;
}

export async function getSessionTokenSafe() {
  const app = getAppBridge();
  if (!app) return null;
  const now = Date.now();
  if (tokenPromise && now < tokenExpiry) return tokenPromise;
  tokenPromise = getSessionToken(app)
    .then((token) => {
      // Tokens are short-lived; refresh slightly early.
      tokenExpiry = Date.now() + 30 * 1000;
      return token;
    })
    .catch(() => null);
  return tokenPromise;
}
