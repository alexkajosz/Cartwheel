require("dotenv").config();
const fs = require("fs");
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { exec } = require("child_process");


const app = express();
app.set("trust proxy", 1);
// v0.4.1 â€” Content Intent Types (authoritative, backend truth)
const CONTENT_INTENTS = {
  INFORMATIONAL: "informational",   // educate, explain, answer questions
  COMMERCIAL: "commercial",         // compare, evaluate, buyer guidance
  TRANSACTIONAL: "transactional",   // purchase-oriented, conversions
  NAVIGATIONAL: "navigational"      // brand / internal navigation support
};

// v0.4 â€” Intent classifier (pure function; NOT wired yet)
function classifyContentIntent(topic, businessContext) {
  const t = String(topic || "").toLowerCase();

  // Default: safest, least salesy
  let intent = CONTENT_INTENTS.INFORMATIONAL;

  // Commercial investigation (comparisons / best / vs)
  if (
    t.includes("best ") ||
    t.includes("top ") ||
    t.includes("vs ") ||
    t.includes("versus ") ||
    t.includes("compare") ||
    t.includes("comparison") ||
    t.includes("review") ||
    t.includes("guide to choosing") ||
    t.includes("how to choose")
  ) {
    intent = CONTENT_INTENTS.COMMERCIAL;
  }

  // Transactional (strong purchase signals)
  if (
    t.includes("buy ") ||
    t.includes("price") ||
    t.includes("discount") ||
    t.includes("coupon") ||
    t.includes("deal") ||
    t.includes("where to buy")
  ) {
    intent = CONTENT_INTENTS.TRANSACTIONAL;
  }

  // Navigational (brand / store specific)
  const bn = String(businessContext?.business_name || "").toLowerCase();
  if (bn && (t.includes(bn) || t.includes("shipping") || t.includes("returns"))) {
    intent = CONTENT_INTENTS.NAVIGATIONAL;
  }

  return intent;
}

app.use(express.json());

function basicClean(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\u2019/g, "'")
    .trim();
}

function normalizeContentIntent(intent) {
  const val = String(intent || "").toLowerCase().trim();
  if (val === "commercial") return "commercial";
  if (val === "transactional") return "transactional";
  return "informational";
}

function getTopicTitle(item) {
  if (!item) return "";
  if (typeof item === "string") return String(item).trim();
  if (typeof item === "object") {
    return String(item.title || item.topic || "").trim();
  }
  return "";
}

function getTopicIntent(item, cfg) {
  if (item && typeof item === "object" && item.intent) {
    return normalizeContentIntent(item.intent);
  }
  const title = getTopicTitle(item);
  if (!title) return normalizeContentIntent(cfg?.contentIntentDefault);
  return normalizeContentIntent(classifyContentIntent(title, cfg?.businessContext));
}

function normalizeTopicItem(item, cfg) {
  const title = getTopicTitle(item);
  if (!title) return null;
  return {
    title,
    intent: getTopicIntent(item, cfg)
  };
}

async function cleanInputAI({ field, text, maxChars = 2000 }) {
  const raw = basicClean(text).slice(0, maxChars);
  if (!raw) {
    return { valid: false, cleaned: "", reason: "Empty input", ai: false };
  }

  if (!OPENAI_API_KEY) {
    return { valid: true, cleaned: raw, reason: null, ai: false };
  }

  const fieldHint = field ? `Field: ${field}` : "Field: general";
  const prompt = `
You are a strict input cleaner for a business app.
${fieldHint}

Rules:
- Fix spelling and obvious typos.
- Remove garbage text (random characters, emoji spam, URLs) unless meaningful.
- Preserve the user's meaning and intent.
- If input is nonsense or empty, return valid=false.
- Return ONLY JSON: {"valid":boolean,"cleaned":string,"reason":string|null}

Input:
${raw}
`.trim();

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        temperature: 0.1,
        max_output_tokens: 300,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    const textOut =
      (data.output_text ||
        data.output?.[0]?.content?.[0]?.text ||
        "").trim();

    const cleanedText = textOut
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanedText);
    const cleaned = basicClean(parsed?.cleaned || "");
    const valid = !!parsed?.valid && !!cleaned;
    return {
      valid,
      cleaned: cleaned || "",
      reason: parsed?.reason || (valid ? null : "Invalid input"),
      ai: true
    };
  } catch {
    return { valid: true, cleaned: raw, reason: null, ai: false };
  }
}

async function inferIndustryAI(seedText) {
  const seed = basicClean(seedText);
  if (!seed || !OPENAI_API_KEY) return "";

  const prompt = `
You are classifying a business industry.
Based on the products/collections below, return a short industry label.
Return ONLY JSON: {"industry":"..."} (max 80 chars).

Data:
${seed}
`.trim();

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        temperature: 0.2,
        max_output_tokens: 120,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    const textOut =
      (data.output_text ||
        data.output?.[0]?.content?.[0]?.text ||
        "").trim();
    const cleanedText = textOut
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanedText);
    return basicClean(parsed?.industry || "").slice(0, 80);
  } catch {
    return "";
  }
}

async function cleanListAI({ field, items, maxItems = 80 }) {
  const list = Array.isArray(items) ? items.map(basicClean).filter(Boolean) : [];
  if (!list.length) return [];
  if (!OPENAI_API_KEY) return list.slice(0, maxItems);

  const prompt = `
You are cleaning a list of items for a business app.
Field: ${field || "list"}

Rules:
- Remove garbage, fragments, or filler words (e.g., "and", "bold", "flavorful").
- Fix typos and normalize capitalization.
- Keep only meaningful product/service names.
- Return ONLY JSON: {"items":["...","..."]}

Items:
${list.slice(0, maxItems).join(" | ")}
`.trim();

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        temperature: 0.1,
        max_output_tokens: 400,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    const textOut =
      (data.output_text ||
        data.output?.[0]?.content?.[0]?.text ||
        "").trim();
    const cleanedText = textOut
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanedText);
    const cleanedItems = Array.isArray(parsed?.items) ? parsed.items : [];
    return cleanedItems.map(basicClean).filter(Boolean).slice(0, maxItems);
  } catch {
    return list.slice(0, maxItems);
  }
}


// --- CONFIG ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Shopify OAuth (v0.4+ â†’ v1.0 path)
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const APP_COOKIE_SECRET = process.env.APP_COOKIE_SECRET || SHOPIFY_CLIENT_SECRET || "dev-secret";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:8080";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

// Minimal-but-complete v0.4 scopes (content + products)
const SHOPIFY_OAUTH_SCOPES = "read_content,write_content,read_products,read_orders,read_customers";

// Local callback path (Shopify app redirect URL must point here)
const SHOPIFY_OAUTH_CALLBACK_PATH = "/admin/shopify/oauth/callback";

const DEFAULT_BLOG_ID = String(process.env.BLOG_ID || "");
const AUTHOR_NAME = "Monroe Mushroom Co";
const DEFAULT_TAGS = ["seo", "mushrooms"];
const BILLING_PLAN = {
  name: "Cartwheel Starter",
  price: 19,
  currency: "USD",
  trialDays: 1
};
const BILLING_TEST = String(process.env.SHOPIFY_BILLING_TEST || "").toLowerCase() === "true";
const TASK_NAME = "Shopify SEO Robot";
const ROBOT_BAT = path.join(__dirname, "robot-start.bat");
const STARTUP_DIR = process.env.APPDATA
  ? path.join(process.env.APPDATA, "Microsoft\\Windows\\Start Menu\\Programs\\Startup")
  : "";
const STARTUP_CMD = STARTUP_DIR ? path.join(STARTUP_DIR, `${TASK_NAME}.cmd`) : "";
const CONFIG_PATH = path.join(__dirname, "config.json");

const DATA_DIR = path.join(__dirname, "data");
const SHOPS_DIR = path.join(DATA_DIR, "shops");
const ACTIVITY_DIR = path.join(DATA_DIR, "activity");
const SYSTEM_LOG_DIR = path.join(DATA_DIR, "system");
const SQLITE_PATH = process.env.SQLITE_PATH || "";
let db = null;

try {
  fs.mkdirSync(SHOPS_DIR, { recursive: true });
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
  fs.mkdirSync(SYSTEM_LOG_DIR, { recursive: true });
} catch {}

function dbEnabled() {
  return !!SQLITE_PATH;
}

function getDb() {
  if (!dbEnabled()) return null;
  if (!db) {
    let Database;
    try {
      Database = require("better-sqlite3");
    } catch (e) {
      throw new Error("better-sqlite3 not installed. Run npm install or remove SQLITE_PATH.");
    }
    const filePath = String(SQLITE_PATH || "").replace(/^sqlite:/, "");
    db = new Database(filePath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS configs (
        shop TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS activity (
        shop TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS system_logs (
        shop TEXT PRIMARY KEY,
        log TEXT NOT NULL,
        updated_at TEXT
      );
    `);
  }
  return db;
}

function dbGetConfig(shop) {
  const d = getDb();
  if (!d) return null;
  const row = d.prepare("SELECT json FROM configs WHERE shop = ?").get(shop);
  if (!row?.json) return null;
  try { return JSON.parse(row.json); } catch { return null; }
}

function dbSaveConfig(shop, cfg) {
  const d = getDb();
  if (!d) return false;
  d.prepare("INSERT INTO configs (shop, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(shop) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .run(shop, JSON.stringify(cfg), new Date().toISOString());
  return true;
}

function dbGetActivity(shop) {
  const d = getDb();
  if (!d) return null;
  const row = d.prepare("SELECT json FROM activity WHERE shop = ?").get(shop);
  if (!row?.json) return [];
  try { return JSON.parse(row.json); } catch { return []; }
}

function dbSaveActivity(shop, entries) {
  const d = getDb();
  if (!d) return false;
  d.prepare("INSERT INTO activity (shop, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(shop) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .run(shop, JSON.stringify(entries), new Date().toISOString());
  return true;
}

function dbAppendSystemLog(shop, line) {
  const d = getDb();
  if (!d) return false;
  const row = d.prepare("SELECT log FROM system_logs WHERE shop = ?").get(shop);
  const next = `${row?.log || ""}${line}\n`;
  d.prepare("INSERT INTO system_logs (shop, log, updated_at) VALUES (?, ?, ?) ON CONFLICT(shop) DO UPDATE SET log = excluded.log, updated_at = excluded.updated_at")
    .run(shop, next, new Date().toISOString());
  return true;
}

function dbGetSystemLog(shop) {
  const d = getDb();
  if (!d) return "";
  const row = d.prepare("SELECT log FROM system_logs WHERE shop = ?").get(shop);
  return row?.log || "";
}

function dbClearActivity(shop) {
  const d = getDb();
  if (!d) return false;
  d.prepare("DELETE FROM activity WHERE shop = ?").run(shop);
  return true;
}

function dbClearSystemLog(shop) {
  const d = getDb();
  if (!d) return false;
  d.prepare("DELETE FROM system_logs WHERE shop = ?").run(shop);
  return true;
}

function shopKey(shopDomain) {
  return String(shopDomain || "").toLowerCase().replace(/[^a-z0-9.-]/g, "_");
}

function shopConfigPath(shopDomain) {
  return path.join(SHOPS_DIR, `${shopKey(shopDomain)}.json`);
}

function activityPathFor(shopDomain) {
  return path.join(ACTIVITY_DIR, `${shopKey(shopDomain)}.json`);
}

function systemLogPathFor(shopDomain) {
  return path.join(SYSTEM_LOG_DIR, `${shopKey(shopDomain)}.jsonl`);
}

function listShops() {
  try {
    if (dbEnabled()) {
      const d = getDb();
      const rows = d.prepare("SELECT shop FROM configs").all();
      return rows.map(r => String(r.shop || "")).filter(Boolean);
    }
    const files = fs.readdirSync(SHOPS_DIR).filter(f => f.endsWith(".json"));
    return files.map(f => {
      const raw = fs.readFileSync(path.join(SHOPS_DIR, f), "utf-8");
      const cfg = JSON.parse(raw);
      return String(cfg?.shopify?.shopDomain || cfg?.shopDomain || "").trim();
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function parseCookies(req) {
  const raw = String(req.headers?.cookie || "");
  return raw.split(";").reduce((acc, part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function signShop(shopDomain) {
  return crypto.createHmac("sha256", APP_COOKIE_SECRET).update(String(shopDomain)).digest("hex");
}

function setShopCookie(res, shopDomain, req) {
  const sig = signShop(shopDomain);
  const secure = req?.headers?.["x-forwarded-proto"] === "https" || req?.secure === true;
  const sameSite = secure ? "None" : "Lax";
  const base = `Path=/; SameSite=${sameSite}; Max-Age=${60 * 60 * 24 * 30}`;
  const secureFlag = secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `cw_shop=${encodeURIComponent(shopDomain)}; ${base}${secureFlag}`,
    `cw_sig=${sig}; ${base}${secureFlag}`,
  ]);
}

function clearShopCookie(res) {
  res.setHeader("Set-Cookie", [
    "cw_shop=; Path=/; Max-Age=0",
    "cw_sig=; Path=/; Max-Age=0",
  ]);
}

function getShopFromReq(req) {
  const cookies = parseCookies(req);
  const shop = cookies.cw_shop;
  const sig = cookies.cw_sig;
  if (!shop || !sig) return null;
  if (signShop(shop) !== sig) return null;
  return shop;
}

function requireShop(req, res) {
  const shop = getShopFromReq(req);
  if (!shop) {
    res.status(401).json({ ok: false, error: "not_authenticated" });
    return null;
  }
  return shop;
}

function getCfgFromReq(req, res) {
  const shop = req.shopDomain || requireShop(req, res);
  if (!shop) return null;
  const cfg = loadConfig(shop);
  cfg.shopify = cfg.shopify || { shopDomain: shop, accessToken: "" };
  return { shop, cfg };
}

const PUBLIC_ADMIN_PATHS = new Set([
  "/shopify/oauth/start",
  "/shopify/oauth/callback",
]);
const BILLING_EXEMPT_PATHS = new Set([
  "/shopify/oauth/start",
  "/shopify/oauth/callback",
  "/shopify/context",
  "/billing/status",
  "/billing/start",
  "/billing/confirm",
  "/dev-mode",
  "/config"
]);

app.use("/admin", (req, res, next) => {
  if (PUBLIC_ADMIN_PATHS.has(req.path)) return next();
  const shop = getShopFromReq(req);
  if (!shop) {
    return res.status(401).json({ ok: false, error: "not_authenticated" });
  }
  req.shopDomain = shop;
  if (BILLING_EXEMPT_PATHS.has(req.path)) return next();
  try {
    const cfg = loadConfig(shop);
    const hasAccessToken = !!String(cfg?.shopify?.accessToken || "").trim();
    const setupComplete = cfg?.businessContext?.status === "initialized";
    if (!hasAccessToken || !setupComplete) {
      return next();
    }
    const active = isBillingActive(cfg);
    if (!active) {
      if (cfg.billing?.status === "trial" && cfg.billing?.trialEndsAt) {
        const end = new Date(cfg.billing.trialEndsAt);
        if (!Number.isNaN(end.getTime()) && Date.now() >= end.getTime()) {
          cfg.billing.status = "inactive";
          saveConfig(cfg);
        }
      }
      return res.status(402).json({
        ok: false,
        error: "payment_required",
        trialEndsAt: cfg.billing?.trialEndsAt || null
      });
    }
  } catch {}
  return next();
});


// Settings UI: Test Post button — does NOT count toward daily limits
app.post("/admin/testpost", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const session = getShopifySession(cfg);
    const publish = !!req.body?.publish;

    if (!session) {
      return res.status(400).json({ ok: false, error: "Shopify not connected" });
    }
    const blogId = await resolveBlogId(cfg, session);
    if (!blogId) {
      return res.status(400).json({ ok: false, error: "Missing blog ID" });
    }

    const url = `https://${session.shopDomain}/admin/api/2025-07/graphql.json`;

    const mutation = `
      mutation CreateArticle($article: ArticleCreateInput!) {
        articleCreate(article: $article) {
          article { id title handle isPublished }
          userErrors { code field message }
        }
      }
    `;

    const variables = {
      article: {
        blogId,
        title: `Test post ${new Date().toISOString()}`,
        author: { name: AUTHOR_NAME },
        body:
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
          "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
        isPublished: publish,
      },
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    const data = await r.json().catch(() => null);
    const errs = data?.data?.articleCreate?.userErrors || [];
    const created = data?.data?.articleCreate?.article;

    if (!r.ok || errs.length > 0 || !created?.id) {
      return res.status(500).json({
        ok: false,
        error: errs.length ? errs.map(e => e.message).join(" | ") : "Test post failed",
        shopify: data,
      });
    }

    // IMPORTANT: do NOT increment dailyUsage here
    return res.json({
      ok: true,
      title: created.title,
      articleId: created.id,
      isPublished: !!created.isPublished,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// Shopify OAuth start â€” redirects to Shopify authorize page
// Usage: /admin/shopify/oauth/start?shop=your-store.myshopify.com
app.get("/admin/shopify/oauth/start", (req, res) => {
  try {
    const rawShop = String(req.query?.shop || "").trim();
    const forceLogin = String(req.query?.force || "").trim() === "1";
    let shop = rawShop
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .trim();
    if (shop.includes("?")) shop = shop.split("?")[0].trim();

    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
      return res.status(500).send("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET");
    }

    if (!shop || !shop.includes(".myshopify.com")) {
      return res.status(400).send("Missing or invalid shop (must be *.myshopify.com)");
    }

    const state = crypto.randomBytes(16).toString("hex");

    const cfg = loadConfig(shop);
    cfg.shopifyOAuth = {
      shopDomain: shop,
      state,
      createdAt: Date.now()
    };
    saveConfig(cfg);

    const baseUrl = PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}${SHOPIFY_OAUTH_CALLBACK_PATH}`;

    const authUrl =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(SHOPIFY_CLIENT_ID)}` +
      `&scope=${encodeURIComponent(SHOPIFY_OAUTH_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      (forceLogin ? `&prompt=login` : "");

    if (forceLogin) {
      const logoutUrl = `https://admin.shopify.com/logout?return_to=${encodeURIComponent(authUrl)}`;
      return res.redirect(logoutUrl);
    }

    return res.redirect(authUrl);
  } catch (e) {
    return res.status(500).send(String(e || "OAuth start failed"));
  }
});

// Shopify OAuth callback â€” validates state + HMAC, exchanges code for access token
app.get("/admin/shopify/oauth/callback", async (req, res) => {
  try {
    const shop = String(req.query?.shop || "").trim();
    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();
    const hmac = String(req.query?.hmac || "").trim();

    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
      return res.status(500).send("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET");
    }

    if (!shop || !shop.includes(".myshopify.com")) {
      return res.status(400).send("Missing or invalid shop");
    }
    if (!code) return res.status(400).send("Missing code");
    if (!state) return res.status(400).send("Missing state");
    if (!hmac) return res.status(400).send("Missing hmac");

    // Validate state against what we stored in config
    const cfg0 = loadConfig(shop);
    const pending = cfg0.shopifyOAuth || null;

    if (!pending || String(pending.state || "") !== state || String(pending.shopDomain || "") !== shop) {
      return res.status(400).send("Invalid or expired OAuth state");
    }

    // Validate Shopify HMAC
    // Build message from query params (excluding hmac and signature), sorted, as key=value joined by &
    const qp = { ...req.query };
    delete qp.hmac;
    delete qp.signature;

    const msg = Object.keys(qp)
      .sort()
      .map((k) => `${k}=${Array.isArray(qp[k]) ? qp[k].join(",") : String(qp[k])}`)
      .join("&");

    const digest = crypto
      .createHmac("sha256", SHOPIFY_CLIENT_SECRET)
      .update(msg)
      .digest("hex");

    // timingSafeEqual requires same length buffers
    const a = Buffer.from(digest, "utf8");
    const b = Buffer.from(hmac, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).send("Invalid HMAC");
    }

     // Exchange authorization code for access token
const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_id: SHOPIFY_CLIENT_ID,
    client_secret: SHOPIFY_CLIENT_SECRET,
    code
  })
});

// IMPORTANT: read raw text so we can see Shopify's real error
const tokenText = await tokenRes.text().catch(() => "");
let tokenJson = {};
try { tokenJson = JSON.parse(tokenText || "{}"); } catch {}

const accessToken = String(tokenJson?.access_token || "").trim();

if (!tokenRes.ok || !accessToken) {
  return res
    .status(500)
    .send("Token exchange failed: " + (tokenText || "(empty response)"));
}

    // Persist as the single source of truth
    const cfg = loadConfig(shop);
    cfg.shopify = { shopDomain: shop, accessToken };
    delete cfg.shopifyOAuth; // clear pending state
    saveConfig(cfg);

    logSystem(shop, { type: "shopify_oauth_connected", shopDomain: shop });

// If OAuth succeeded, Shopify is connected.
// Make setup wizard move past "Connect Shopify".
const cfg2 = loadConfig(shop);
cfg2.businessContext = cfg2.businessContext || {};
cfg2.businessContext.status = cfg2.businessContext.status || "uninitialized";

// Shopify connect is Step 0.
// After OAuth connect, we should go to Step 1 (business name).
// If we're still blocked (setup not finished), force Step 1 after OAuth connect.
if (cfg2._postingBlocked === true) {
  cfg2.businessContext.setupStep = 1;
}

// Step 1 is now "Connect Shopify".
// So after OAuth connect, we advance to Step 2.

saveConfig(cfg2);

// Set session cookie for this shop
setShopCookie(res, shop, req);

    // Back to UI (frontend app)
    const redirectBase = FRONTEND_ORIGIN || "/";
    return res.redirect(`${redirectBase}/?shopify=connected`);
  } catch (e) {
    return res.status(500).send(String(e || "OAuth callback failed"));
  }
});

// AI input cleaning (best-effort)
app.post("/admin/ai/clean-input", async (req, res) => {
  try {
    const field = String(req.body?.field || "").trim();
    const text = String(req.body?.text || "");
    const maxChars = Number(req.body?.maxChars || 2000);

    const result = await cleanInputAI({ field, text, maxChars });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

function normalizeTimeHHMM(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  return `${hh}:${mm}`;
}

function toTimesArray(timeField) {
  // Accepts: ["09:00","18:00"] OR "09:00, 18:00"
  if (Array.isArray(timeField)) {
    return timeField.map(normalizeTimeHHMM).filter(Boolean);
  }
  return String(timeField || "")
    .split(",")
    .map(t => normalizeTimeHHMM(t))
    .filter(Boolean);
}

function defaultConfig(shopDomain) {
  return {
    mode: "live",
    timezone: "America/New_York",
    uiDevMode: true,
    robotEnabled: true,
    dailyLimit: { enabled: true, maxPerDay: 3, devBypass: false },
    dailyUsage: { dayKey: getTodayKey("America/New_York"), count: 0 },
    port: 3000,
    schedules: [
      { enabled: true, daysOfWeek: ["Mon"], times: ["09:00"], mode: "live" }
    ],
    schedule: { daysOfWeek: ["Mon"], time: "09:00" },
    topics: [],
    topicGen: { enabled: true, minTopics: 3, batchSize: 5, includeProductPosts: false },
    topicStrategy: "queue",
    topicArchive: [],
    previewCache: {},
    contentIntentDefault: "informational",
    businessContext: { status: "uninitialized", setupStep: 0 },
    lastRun: null,
    lastPost: null,
    _postingBlocked: true,
    excludedTopics: [],
    billing: {
      status: "inactive",
      trialEndsAt: null,
      lastCheckAt: null,
      plan: BILLING_PLAN
    },
    devMode: {
      bypassBilling: false,
      bypassDailyLimit: false
    },
    shopDomain: shopDomain || undefined,
    shopify: shopDomain ? { shopDomain, accessToken: "" } : undefined
  };
}

function loadConfig(shopDomain) {
  if (!shopDomain) throw new Error("Missing shopDomain");
  if (dbEnabled()) {
    let cfg = dbGetConfig(shopDomain);
  if (!cfg) {
      const cfgPath = shopConfigPath(shopDomain);
      if (fs.existsSync(cfgPath)) {
        try {
          const legacyFile = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
          dbSaveConfig(shopDomain, legacyFile);
          cfg = legacyFile;
        } catch {}
      }
    }
    if (!cfg) {
      // try migrate legacy global config once (best-effort)
      if (fs.existsSync(CONFIG_PATH)) {
        try {
          const legacy = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
          if (legacy?.shopify?.shopDomain === shopDomain) {
            dbSaveConfig(shopDomain, legacy);
            cfg = legacy;
          }
        } catch {}
      }
    }
    if (!cfg) {
      const fresh = defaultConfig(shopDomain);
      dbSaveConfig(shopDomain, fresh);
      cfg = fresh;
    }
    cfg.previewCache = cfg.previewCache || {};
    if (cfg.mode !== "live" && cfg.mode !== "draft") {
      cfg.mode = "live";
      dbSaveConfig(shopDomain, cfg);
    }
    if (!cfg.shopDomain && shopDomain) {
      cfg.shopDomain = shopDomain;
    }
    if (!cfg.billing) {
      cfg.billing = {
        status: "inactive",
        trialEndsAt: null,
        lastCheckAt: null,
        plan: BILLING_PLAN
      };
    }
    if (!cfg.devMode) {
      cfg.devMode = { bypassBilling: false, bypassDailyLimit: false };
    }
    // continue through migrations below
    return (function applyMigrations(cfg) {
      // --- v0.2 migration: cfg.schedules[] becomes source of truth ---
      // If schedules[] missing, build it from legacy cfg.schedule
      if (!Array.isArray(cfg.schedules) || cfg.schedules.length === 0) {
        const legacyDays = Array.isArray(cfg.schedule?.daysOfWeek) ? cfg.schedule.daysOfWeek : [];
        const legacyTimes = toTimesArray(cfg.schedule?.time);

        cfg.schedules = [
          {
            enabled: true,
            daysOfWeek: legacyDays,
            times: legacyTimes,
            mode: "live"
          }
        ];

        // Keep legacy cfg.schedule around for now (compat), but ensure it exists
        if (!cfg.schedule) cfg.schedule = { daysOfWeek: legacyDays, time: legacyTimes.join(", ") };

        // Persist migration immediately so restarts are deterministic
        dbSaveConfig(shopDomain, cfg);
      }

      // Normalize all schedules (defensive)
      cfg.schedules = cfg.schedules.map(p => ({
        enabled: (p && typeof p.enabled === "boolean") ? p.enabled : true,
        daysOfWeek: Array.isArray(p?.daysOfWeek) ? p.daysOfWeek.map(d => String(d).trim()).filter(Boolean) : [],
        times: toTimesArray(p?.times ?? p?.time),
        mode: p?.mode === "draft" ? "draft" : "live"
      }));

      // --- v0.3 posting gate: business context required ---
      if (!cfg.businessContext || cfg.businessContext.status !== "initialized") {
        cfg._postingBlocked = true;
      } else {
        cfg._postingBlocked = false;
      }

      // --- v0.3 defaults: topic generator off until setup completes ---
      cfg.topicGen = cfg.topicGen || {};
      if (typeof cfg.topicGen.includeProductPosts === "undefined") {
        cfg.topicGen.includeProductPosts = false;
      }
      if (cfg._postingBlocked === true) {
        if (typeof cfg.topicGen.enabled === "undefined") cfg.topicGen.enabled = false;
      } else {
        if (typeof cfg.topicGen.enabled === "undefined") cfg.topicGen.enabled = true;
      }

      // --- v0.6 migration: daily limit default to 3 ---
      let dailyLimitChanged = false;
      cfg.dailyLimit = cfg.dailyLimit || { enabled: true, maxPerDay: 3, devBypass: false };
      if (!Number.isFinite(cfg.dailyLimit.maxPerDay) || cfg.dailyLimit.maxPerDay < 3) {
        cfg.dailyLimit.maxPerDay = 3;
        dailyLimitChanged = true;
      }
      if (dailyLimitChanged) {
        dbSaveConfig(shopDomain, cfg);
      }

      // --- v0.7 defaults: content intent + topic shape ---
      let topicsChanged = false;
      cfg.contentIntentDefault = normalizeContentIntent(
        cfg.contentIntentDefault || cfg.businessContext?.content_intent_default || "informational"
      );
      cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
      cfg.topics = cfg.topics.map((item) => {
        const normalized = normalizeTopicItem(item, cfg);
        if (!normalized) return null;
        const originalTitle = getTopicTitle(item);
        if (originalTitle !== normalized.title || !item?.intent) topicsChanged = true;
        return normalized;
      }).filter(Boolean);
      if (topicsChanged) {
        dbSaveConfig(shopDomain, cfg);
      }

      // Daily usage rolling reset
      const todayKey = getTodayKey(cfg?.timezone);
      if (!cfg.dailyUsage) {
        cfg.dailyUsage = { dayKey: todayKey, count: 0 };
      }
      if (cfg.dailyUsage.dayKey !== todayKey) {
        cfg.dailyUsage.dayKey = todayKey;
        cfg.dailyUsage.count = 0;
      }

      return cfg;
    })(cfg);
  }

  const cfgPath = shopConfigPath(shopDomain);
  if (!fs.existsSync(cfgPath)) {
    // try migrate legacy config once (best-effort)
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
        if (legacy?.shopify?.shopDomain === shopDomain) {
          fs.writeFileSync(cfgPath, JSON.stringify(legacy, null, 2), "utf-8");
        }
      } catch {}
    }
  }

  if (!fs.existsSync(cfgPath)) {
    const fresh = defaultConfig(shopDomain);
    fs.writeFileSync(cfgPath, JSON.stringify(fresh, null, 2), "utf-8");
  }

  const raw = fs.readFileSync(cfgPath, "utf-8");
  const cfg = JSON.parse(raw);
  cfg.previewCache = cfg.previewCache || {};
  if (cfg.mode !== "live" && cfg.mode !== "draft") {
    cfg.mode = "live";
    saveConfig(cfg);
  }
  if (!cfg.shopDomain && shopDomain) {
    cfg.shopDomain = shopDomain;
  }
  if (!cfg.billing) {
    cfg.billing = {
      status: "inactive",
      trialEndsAt: null,
      lastCheckAt: null,
      plan: BILLING_PLAN
    };
  }
  if (!cfg.devMode) {
    cfg.devMode = { bypassBilling: false, bypassDailyLimit: false };
  }

  // --- v0.2 migration: cfg.schedules[] becomes source of truth ---
  // If schedules[] missing, build it from legacy cfg.schedule
  if (!Array.isArray(cfg.schedules) || cfg.schedules.length === 0) {
    const legacyDays = Array.isArray(cfg.schedule?.daysOfWeek) ? cfg.schedule.daysOfWeek : [];
    const legacyTimes = toTimesArray(cfg.schedule?.time);

    cfg.schedules = [
      {
        enabled: true,
        daysOfWeek: legacyDays,
        times: legacyTimes,
        mode: "live"
      }
    ];

    // Keep legacy cfg.schedule around for now (compat), but ensure it exists
    if (!cfg.schedule) cfg.schedule = { daysOfWeek: legacyDays, time: legacyTimes.join(", ") };

    // Persist migration immediately so restarts are deterministic
    saveConfig(cfg);
  }

  // Normalize all schedules (defensive)
  cfg.schedules = cfg.schedules.map(p => ({
    enabled: (p && typeof p.enabled === "boolean") ? p.enabled : true,
    daysOfWeek: Array.isArray(p?.daysOfWeek) ? p.daysOfWeek.map(d => String(d).trim()).filter(Boolean) : [],
    times: toTimesArray(p?.times ?? p?.time),
    mode: p?.mode === "draft" ? "draft" : "live"
  }));

  // --- v0.3 posting gate: business context required ---
  if (!cfg.businessContext || cfg.businessContext.status !== "initialized") {
    cfg._postingBlocked = true;
  } else {
    cfg._postingBlocked = false;
  }

  // --- v0.3 defaults: topic generator off until setup completes ---
  cfg.topicGen = cfg.topicGen || {};
  if (typeof cfg.topicGen.includeProductPosts === "undefined") {
    cfg.topicGen.includeProductPosts = false;
  }
  if (cfg._postingBlocked === true) {
    if (typeof cfg.topicGen.enabled === "undefined") cfg.topicGen.enabled = false;
  } else {
    if (typeof cfg.topicGen.enabled === "undefined") cfg.topicGen.enabled = true;
  }

  // --- v0.6 migration: daily limit default to 3 ---
  let dailyLimitChanged = false;
  cfg.dailyLimit = cfg.dailyLimit || { enabled: true, maxPerDay: 3, devBypass: false };
  if (!Number.isFinite(cfg.dailyLimit.maxPerDay) || cfg.dailyLimit.maxPerDay < 3) {
    cfg.dailyLimit.maxPerDay = 3;
    dailyLimitChanged = true;
  }

  if (dailyLimitChanged) {
    saveConfig(cfg);
  }

  // --- v0.7 defaults: content intent + topic shape ---
  let topicsChanged = false;
  cfg.contentIntentDefault = normalizeContentIntent(
    cfg.contentIntentDefault || cfg.businessContext?.content_intent_default || "informational"
  );
  cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
  cfg.topics = cfg.topics.map((item) => {
    const normalized = normalizeTopicItem(item, cfg);
    if (!normalized) return null;
    const originalTitle = getTopicTitle(item);
    if (originalTitle !== normalized.title || !item?.intent) topicsChanged = true;
    return normalized;
  }).filter(Boolean);
  if (topicsChanged) {
    saveConfig(cfg);
  }

  return cfg;
}

// --- Daily limit helpers (restart-safe) ---

function getNowPartsInTimezone(timezone) {
  const now = new Date();
  try {
    if (timezone) {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const get = (type) => parts.find((p) => p.type === type)?.value;
      const day = get("weekday");
      const year = get("year");
      const month = get("month");
      const date = get("day");
      const hour = get("hour");
      const minute = get("minute");
      if (day && year && month && date && hour && minute) {
        return {
          dayShort: day,
          timeHHMM: `${hour}:${minute}`,
          dayKey: `${year}-${month}-${date}`,
        };
      }
    }
  } catch {
    // fall back to local time
  }

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return {
    dayShort: days[now.getDay()],
    timeHHMM: `${hh}:${mm}`,
    dayKey: now.toDateString(),
  };
}

function getTodayKey(timezone) {
  return getNowPartsInTimezone(timezone).dayKey;
}

function initDailyUsage(cfg) {
  const todayKey = getTodayKey(cfg?.timezone);

  if (!cfg.dailyUsage) {
    cfg.dailyUsage = { dayKey: todayKey, count: 0 };
    return true;
  }

  if (cfg.dailyUsage.dayKey !== todayKey) {
    cfg.dailyUsage.dayKey = todayKey;
    cfg.dailyUsage.count = 0;
    return true;
  }

  return false;
}

function saveConfig(cfg) {
  const shopDomain = String(cfg?.shopify?.shopDomain || cfg?.shopDomain || "").trim();
  if (!shopDomain) throw new Error("Missing shopDomain in config");
  if (dbEnabled()) {
    dbSaveConfig(shopDomain, cfg);
    return;
  }
  const cfgPath = shopConfigPath(shopDomain);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf-8");
}

async function shopifyGraphQL(shopDomain, accessToken, query, variables) {
  const shopifyUrl = `https://${shopDomain}/admin/api/2025-07/graphql.json`;
  const res = await fetch(shopifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json().catch(() => ({}));
  return data;
}

async function fetchActiveSubscriptions(shopDomain, accessToken) {
  const query = `
    query AppSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          name
          status
          createdAt
          trialDays
        }
      }
    }
  `;
  const data = await shopifyGraphQL(shopDomain, accessToken, query, {});
  const subs = data?.data?.currentAppInstallation?.activeSubscriptions || [];
  return Array.isArray(subs) ? subs : [];
}

async function createSubscription(shopDomain, accessToken, returnUrl) {
  const mutation = `
    mutation CreateSubscription($name: String!, $returnUrl: URL!, $price: MoneyInput!, $trialDays: Int, $test: Boolean!) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        test: $test,
        trialDays: $trialDays,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: $price
              }
            }
          }
        ]
      ) {
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = {
    name: BILLING_PLAN.name,
    returnUrl,
    price: { amount: BILLING_PLAN.price, currencyCode: BILLING_PLAN.currency },
    trialDays: BILLING_PLAN.trialDays,
    test: BILLING_TEST
  };
  const data = await shopifyGraphQL(shopDomain, accessToken, mutation, variables);
  const resp = data?.data?.appSubscriptionCreate;
  const errors = resp?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map(e => e.message).join(" | "));
  }
  return resp?.confirmationUrl || null;
}

function computeTrialEndsAt(createdAt, trialDays) {
  if (!createdAt || !trialDays) return null;
  const base = new Date(createdAt);
  if (Number.isNaN(base.getTime())) return null;
  const end = new Date(base.getTime() + Number(trialDays) * 24 * 60 * 60 * 1000);
  return end.toISOString();
}

function isBillingActive(cfg) {
  if (cfg?.devMode?.bypassBilling) return true;
  const status = String(cfg?.billing?.status || "inactive");
  if (status === "active") return true;
  if (status === "trial" && cfg?.billing?.trialEndsAt) {
    const end = new Date(cfg.billing.trialEndsAt);
    if (!Number.isNaN(end.getTime()) && Date.now() < end.getTime()) return true;
  }
  return false;
}

// --- Shopify session (local, per-store) ---
// Source of truth: config.json (NOT env)
// Shape:
// cfg.shopify = { shopDomain: "xxx.myshopify.com", accessToken: "shpat_..." }
function getShopifySession(cfg) {
  const s = cfg?.shopify || null;
  const shopDomain = String(s?.shopDomain || "").trim();
  const accessToken = String(s?.accessToken || "").trim();

  if (!shopDomain || !accessToken) return null;
  return { shopDomain, accessToken };
}

// Save a small, safe Shopify snapshot for better writing (NO PII).
// This becomes "business truth" GPT can use later.
function saveShopifyInsightsSnapshot(shopDomain, insights) {
  const cfg = loadConfig(shopDomain);
  cfg.businessContext = cfg.businessContext || {};
  cfg.businessContext.status = cfg.businessContext.status || "uninitialized";

  cfg.businessContext.shopifyInsights = insights; // aggregated only
  cfg.businessContext.shopifyInsights_at = new Date().toISOString();

  saveConfig(cfg);
}

function getExcludedTopics(cfg) {
  return Array.isArray(cfg?.excludedTopics) ? cfg.excludedTopics : [];
}

function setExcludedTopics(shopDomain, list) {
  const cfg = loadConfig(shopDomain);
  cfg.excludedTopics = Array.isArray(list) ? list : [];
  saveConfig(cfg);
}

function isExcludedTopic(cfg, topic) {
  const t = String(topic || "").toLowerCase().trim();
  if (!t) return false;

  const excluded = getExcludedTopics(cfg)
    .map(x => String(x || "").toLowerCase().trim())
    .filter(Boolean);

  for (const ex of excluded) {
    if (t.includes(ex)) return ex; // return the matched phrase
  }
  return false;
}

function getFirstDueProfileIndexNow(cfg) {
  const now = new Date();
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const today = days[now.getDay()];

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const currentTime = `${hh}:${mm}`;

  const profiles = Array.isArray(cfg.schedules) ? cfg.schedules : [];

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    if (!p || p.enabled === false) continue;

    const daysOfWeek = Array.isArray(p.daysOfWeek) ? p.daysOfWeek : [];
    const times = Array.isArray(p.times) ? p.times : toTimesArray(p.time);

    if (daysOfWeek.includes(today) && times.includes(currentTime)) {
      return i;
    }
  }

  return null;
}


function getAllDueProfileIndexesNow(cfg, nowParts) {
  const parts = nowParts || getNowPartsInTimezone(cfg?.timezone);
  const today = parts.dayShort;
  const currentTime = parts.timeHHMM;

  const profiles = Array.isArray(cfg.schedules) ? cfg.schedules : [];
  const due = [];

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    if (!p || p.enabled === false) continue;

    const daysOfWeek = Array.isArray(p.daysOfWeek) ? p.daysOfWeek : [];
    const times = Array.isArray(p.times) ? p.times : toTimesArray(p.time);

    if (daysOfWeek.includes(today) && times.includes(currentTime)) {
      due.push(i);
    }
  }

  return due;
}

function shouldPostNow(cfg) {
  return getAllDueProfileIndexesNow(cfg).length > 0;
}


async function resolveBlogId(cfg, session) {
  if (cfg?.blogId) return cfg.blogId;
  if (DEFAULT_BLOG_ID) {
    cfg.blogId = DEFAULT_BLOG_ID;
    saveConfig(cfg);
    return cfg.blogId;
  }
  try {
    const shopifyUrl = `https://${session.shopDomain}/admin/api/2025-07/graphql.json`;
    const query = `
      query GetBlogs($first: Int!) {
        blogs(first: $first) {
          edges {
            node { id title }
          }
        }
      }
    `;
    const r = await fetch(shopifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query, variables: { first: 5 } }),
    });
    const data = await r.json().catch(() => null);
    const blogId = data?.data?.blogs?.edges?.[0]?.node?.id || "";
    if (blogId) {
      cfg.blogId = blogId;
      saveConfig(cfg);
      return blogId;
    }
  } catch {
    // fall through
  }
  return "";
}

const PRODUCT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function normalizeTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const STOPWORDS = new Set([
  "the","and","or","for","with","from","your","you","our","a","an","to","of","in","on","by","at","is","are","be","as","it","this","that"
]);

function scoreProductForTopic(topicTokens, product) {
  const fields = [
    product?.title,
    product?.productType,
    product?.vendor,
    Array.isArray(product?.tags) ? product.tags.join(" ") : ""
  ];
  const hay = normalizeTokens(fields.join(" "));
  let score = 0;
  for (const t of topicTokens) {
    if (STOPWORDS.has(t)) continue;
    if (hay.includes(t)) score += 1;
  }
  return score;
}

async function fetchShopifyProducts(session, limit = 100) {
  const query = `
    query Products($first: Int!) {
      shop {
        primaryDomain { host }
        myshopifyDomain
      }
      products(first: $first) {
        edges {
          node {
            id
            title
            handle
            productType
            vendor
            tags
            onlineStoreUrl
          }
        }
      }
    }
  `;
  const r = await fetch(`https://${session.shopDomain}/admin/api/2025-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": session.accessToken
    },
    body: JSON.stringify({ query, variables: { first: limit } })
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.errors) {
    throw new Error("Shopify request failed");
  }
  const shop = json?.data?.shop || null;
  const host = shop?.primaryDomain?.host || shop?.myshopifyDomain || session.shopDomain;
  const items = (json?.data?.products?.edges || [])
    .map(e => e?.node)
    .filter(Boolean)
    .map(p => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      productType: p.productType,
      vendor: p.vendor,
      tags: p.tags || [],
      url: p.onlineStoreUrl || (host && p.handle ? `https://${host}/products/${p.handle}` : null)
    }));
  return items;
}

async function getProductCatalog(cfg, session) {
  const cache = cfg?.productCache || null;
  const now = Date.now();
  if (cache?.at && Array.isArray(cache?.items)) {
    const age = now - new Date(cache.at).getTime();
    if (Number.isFinite(age) && age < PRODUCT_CACHE_TTL_MS) {
      return cache.items;
    }
  }
  const items = await fetchShopifyProducts(session, 100);
  cfg.productCache = { at: new Date().toISOString(), items };
  saveConfig(cfg);
  return items;
}

function selectRelatedProducts(topic, products, max = 2) {
  const tokens = normalizeTokens(topic);
  if (!tokens.length) return [];
  const scored = products
    .map(p => ({ p, score: scoreProductForTopic(tokens, p) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, max).map(x => x.p);
  return picked;
}

function buildProductLinkHtml(topic, products) {
  if (!products.length) return "";
  const links = products
    .filter(p => p?.url)
    .map(p => `<a href="${p.url}" target="_blank" rel="noopener noreferrer">${p.title}</a>`);
  if (!links.length) return "";
  if (links.length === 1) {
    return `<p>If you're exploring ${topic}, take a look at ${links[0]}.</p>`;
  }
  return `<p>If you're exploring ${topic}, you may also like ${links.join(", ")}.</p>`;
}

function buildProductLinkMarkdown(topic, products) {
  if (!products.length) return "";
  const links = products
    .filter(p => p?.url)
    .map(p => `[${p.title}](${p.url})`);
  if (!links.length) return "";
  if (links.length === 1) {
    return `\n\nIf you're exploring ${topic}, take a look at ${links[0]}.`;
  }
  return `\n\nIf you're exploring ${topic}, you may also like ${links.join(", ")}.`;
}

async function computeShopifyInsights(session) {
  const query = `
    query Insights {
      shop {
        name
        myshopifyDomain
        primaryDomain { host }
        currencyCode
      }

      products(first: 100) {
        edges {
          node {
            id
            title
            productType
            vendor
            totalInventory
            variants(first: 50) {
              edges {
                node {
                  id
                  price
                  compareAtPrice
                  sku
                }
              }
            }
          }
        }
      }

      collections(first: 50) {
        edges { node { id title } }
      }

      orders(first: 250, sortKey: PROCESSED_AT, reverse: true)
        edges {
          node {
            id
            processedAt
            totalPriceSet { shopMoney { amount currencyCode } }
            discountCode
            customer { id }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                }
              }
            }
            shippingAddress { countryCodeV2 provinceCode }
          }
        }
    }
  `;

  const r = await fetch(`https://${session.shopDomain}/admin/api/2025-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": session.accessToken
    },
    body: JSON.stringify({ query })
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.errors) {
    throw new Error("Shopify request failed");
  }

  const shop = json?.data?.shop || null;
  const products = (json?.data?.products?.edges || []).map(e => e?.node).filter(Boolean);
  const collections = (json?.data?.collections?.edges || []).map(e => e?.node).filter(Boolean);
  const orders = (json?.data?.orders?.edges || []).map(e => e?.node).filter(Boolean);

  const productTypes = {};
  const vendors = {};
  const pricePoints = [];

  for (const p of products) {
    const pt = String(p.productType || "").trim();
    if (pt) productTypes[pt] = (productTypes[pt] || 0) + 1;
    const v = String(p.vendor || "").trim();
    if (v) vendors[v] = (vendors[v] || 0) + 1;
    const variantEdges = p?.variants?.edges || [];
    for (const ve of variantEdges) {
      const price = Number(ve?.node?.price);
      if (Number.isFinite(price)) pricePoints.push(price);
    }
  }

  pricePoints.sort((a, b) => a - b);
  const median = (arr) => {
    if (!arr.length) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  };

  const priceSummary = {
    min: pricePoints.length ? pricePoints[0] : null,
    median: median(pricePoints),
    max: pricePoints.length ? pricePoints[pricePoints.length - 1] : null
  };

  let orderCount = 0;
  let revenue = 0;
  const customersSeen = new Map();
  const geo = {};
  const topItems = {};
  const pairCounts = {};
  let discountedOrders = 0;

  for (const o of orders) {
    orderCount += 1;
    const amt = Number(o?.totalPriceSet?.shopMoney?.amount);
    if (Number.isFinite(amt)) revenue += amt;
    if (o?.discountCode) discountedOrders += 1;

    const custId = o?.customer?.id;
    if (custId) customersSeen.set(custId, (customersSeen.get(custId) || 0) + 1);

    const cc = o?.shippingAddress?.countryCodeV2 || "";
    const pc = o?.shippingAddress?.provinceCode || "";
    const key = cc && pc ? `${cc}-${pc}` : (cc || "Unknown");
    if (key) geo[key] = (geo[key] || 0) + 1;

    const items = (o?.lineItems?.edges || []).map(e => e?.node).filter(Boolean);
    for (const li of items) {
      const title = String(li.title || "").trim();
      if (!title) continue;
      topItems[title] = (topItems[title] || 0) + Number(li.quantity || 0);
    }

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = String(items[i]?.title || "").trim();
        const b = String(items[j]?.title || "").trim();
        if (!a || !b) continue;
        const keyPair = `${a}|||${b}`;
        pairCounts[keyPair] = (pairCounts[keyPair] || 0) + 1;
      }
    }
  }

  const sortTop = (obj, limit = 8) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k, v]) => ({ name: k, value: v }));

  const topProductsByQty = sortTop(topItems, 12);
  const topPairs = Object.entries(pairCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => {
      const [a, b] = k.split("|||");
      return { a, b, count: v };
    });

  const geoTop = sortTop(geo, 10);
  const aov = orderCount > 0 ? revenue / orderCount : null;
  const repeatRate = (() => {
    if (!customersSeen.size) return null;
    let repeat = 0;
    customersSeen.forEach(v => { if (v > 1) repeat += 1; });
    return repeat / customersSeen.size;
  })();

  return {
    shop: shop ? {
      name: shop.name,
      domain: shop.primaryDomain?.host || shop.myshopifyDomain || null,
      currencyCode: shop.currencyCode || null
    } : null,
    catalog: {
      collections: collections.map(c => ({ id: c.id, title: c.title })),
      productTypeTop: sortTop(productTypes, 10),
      vendorTop: sortTop(vendors, 10),
      priceSummary
    },
    orders: {
      sampleSize: orderCount,
      revenueSample: Number.isFinite(revenue) ? revenue : null,
      aov,
      discountedOrderRate: orderCount > 0 ? (discountedOrders / orderCount) : null,
      repeatRate,
      topProductsByQty,
      topPairs,
      geoTop
    }
  };
}

async function getShopifyInsightsForPrompt(cfg, session) {
  const cached = cfg?.businessContext?.shopifyInsights;
  const at = cfg?.businessContext?.shopifyInsights_at;
  if (cached && at) {
    const age = Date.now() - new Date(at).getTime();
    if (Number.isFinite(age) && age < 24 * 60 * 60 * 1000) {
      return cached;
    }
  }
  try {
    const insights = await computeShopifyInsights(session);
    saveShopifyInsightsSnapshot(session.shopDomain, insights);
    return insights;
  } catch {
    return cached || null;
  }
}

async function generateTopics(cfg) {
  const batchSize = cfg.topicGen?.batchSize ?? 10;
  const includeProductPosts = cfg.topicGen?.includeProductPosts === true;
  const session = getShopifySession(cfg);
  const insights = session ? await getShopifyInsightsForPrompt(cfg, session) : (cfg?.businessContext?.shopifyInsights || null);
  const insightsSummary = insights ? JSON.stringify(insights) : "";

  const prompt = `
Generate ${batchSize} SEO blog topic ideas for a US e-commerce brand called Monroe Mushroom Co.
We sell functional mushroom products (example: Lionâ€™s Mane gummies).
Topics should be helpful, not hypey, and avoid medical claims.
${includeProductPosts ? "Include a few product-focused topics (but keep them subtle)." : "Do NOT include product-specific or promotional topics."}
${insightsSummary ? `Shopify insights (use for relevance): ${insightsSummary}` : ""}
Return ONLY valid JSON in this shape:
{ "topics": ["topic 1", "topic 2", "..."] }
No code fences, no markdown.
`;

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: prompt,
    }),
  });

  const data = await resp.json();
  const text =
  (data.output_text ||
    data.output?.[0]?.content?.[0]?.text ||
    "").trim();

const cleaned = text
  .replace(/^```json\s*/i, "")
  .replace(/^```\s*/i, "")
  .replace(/```$/i, "")
  .trim();

// If there's extra text, extract the first JSON object
const start = cleaned.indexOf("{");
const end = cleaned.lastIndexOf("}");
const jsonChunk =
  start !== -1 && end !== -1 && end > start
    ? cleaned.slice(start, end + 1)
    : cleaned;

let parsed;
try {
  parsed = JSON.parse(jsonChunk);
  } catch {
    console.log("TopicGen: OpenAI returned non-JSON:", jsonChunk.slice(0, 200));
    return [];
  }

  const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
  return topics
    .map(t => normalizeTopicItem(String(t).trim(), cfg))
    .filter(Boolean);
}


// Per-shop scheduler state (in-memory)
const schedulerStatusByShop = new Map(); // shop -> ready | posting | paused
const lastPostDayByShop = new Map(); // shop -> dayKey
const postedTimesByShop = new Map(); // shop -> Set
// --- SINGLE INSTANCE LOCK ---
// Prevent two robots from running at once (prevents double scheduler).
const LOCK_PATH = path.join(__dirname, "robot.lock.json");

function isPidRunning(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0); // does not kill, just checks existence
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const raw = fs.readFileSync(LOCK_PATH, "utf-8");
      const prev = JSON.parse(raw);

      const prevPid = Number(prev.pid);
      if (isPidRunning(prevPid)) {
        console.log("Single-instance: another robot is already running. PID:", prevPid);
        return { ok: false, reason: "already-running", pid: prevPid };
      }
    }
  } catch {
    // If lock file is corrupted, we treat it as stale and overwrite it.
  }

  const lockData = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(LOCK_PATH, JSON.stringify(lockData, null, 2), "utf-8");
  } catch (e) {
    console.log("Single-instance: failed to write lock file:", String(e));
    // If we can't write a lock, safest behavior is to refuse to run.
    return { ok: false, reason: "cannot-lock" };
  }

  // Best-effort cleanup (not guaranteed on hard kills)
  const cleanup = () => {
    try {
      if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
    } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGTERM", () => {
  logSystem("global", { type: "robot_stop", reason: "SIGTERM" });
  process.exit(0);
});

  return { ok: true };
}

function loadActivity(shopDomain) {
  try {
    if (dbEnabled()) {
      const data = dbGetActivity(shopDomain);
      return Array.isArray(data) ? data : [];
    }
    const p = activityPathFor(shopDomain);
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function maybeAutoGenerateTopics(shopDomain, cfg) {
  try {
    if (!cfg?.topicGen?.enabled) return;
    if (cfg._postingBlocked === true || cfg.robotEnabled === false) return;

    const minTopics = cfg.topicGen.minTopics ?? 3;
    const current = Array.isArray(cfg.topics) ? cfg.topics.length : 0;
    if (current > minTopics) return;

    if (!OPENAI_API_KEY) {
      logActivity(shopDomain, {
        type: "error",
        source: "auto",
        mode: cfg.mode || "draft",
        title: "Auto topic generation failed: Missing OPENAI_API_KEY",
      });
      return 0;
    }

    const newTopics = await generateTopics(cfg);
    if (newTopics.length > 0) {
      cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
      cfg.topics.push(...newTopics);
      saveConfig(cfg);
      logActivity(shopDomain, {
        type: "topics_generate",
        source: "auto",
        mode: cfg.mode || "draft",
        title: `Auto-generated ${newTopics.length} topics`,
      });
      return newTopics.length;
    } else {
      logActivity(shopDomain, {
        type: "error",
        source: "auto",
        mode: cfg.mode || "draft",
        title: "Auto topic generation returned 0 topics",
      });
      return 0;
    }
  } catch (e) {
    logActivity(shopDomain, {
      type: "error",
      source: "auto",
      mode: cfg?.mode || "draft",
      title: `Auto topic generation failed: ${String(e)}`,
    });
    return 0;
  }
}

function saveActivity(shopDomain, activityLog) {
  try {
    if (dbEnabled()) {
      dbSaveActivity(shopDomain, activityLog);
      return;
    }
    const p = activityPathFor(shopDomain);
    fs.writeFileSync(p, JSON.stringify(activityLog, null, 2), "utf-8");
  } catch {
    // ignore disk errors for now
  }
}

function logActivity(shopDomain, evt) {
  const activityLog = loadActivity(shopDomain);
  activityLog.unshift({ ts: Date.now(), ...evt });
  if (activityLog.length > 200) activityLog.length = 200;
  saveActivity(shopDomain, activityLog);
}

function logSystem(shopDomain, evt) {
  try {
    if (dbEnabled()) {
      dbAppendSystemLog(shopDomain, JSON.stringify({ ts: Date.now(), ...evt }));
      return;
    }
    const p = systemLogPathFor(shopDomain);
    fs.appendFileSync(
      p,
      JSON.stringify({ ts: Date.now(), ...evt }) + "\n",
      "utf-8"
    );
  } catch {
    // ignore disk errors for now
  }
}

function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

function startupStatus() {
  if (!STARTUP_CMD) return false;
  return fs.existsSync(STARTUP_CMD);
}

async function enableStartup() {
  try {
    if (!STARTUP_DIR || !STARTUP_CMD) {
      return { ok: false, stdout: "", stderr: "Startup not supported on this OS" };
    }
    fs.mkdirSync(STARTUP_DIR, { recursive: true });

    const cmdText = `@echo off\r\ncall "${ROBOT_BAT}"\r\n`;
    fs.writeFileSync(STARTUP_CMD, cmdText, "utf-8");

    return { ok: true, stdout: "Startup cmd created", stderr: "" };
  } catch (e) {
    return { ok: false, stdout: "", stderr: String(e) };
  }
}

async function disableStartup() {
  try {
    if (!STARTUP_CMD) {
      return { ok: false, stdout: "", stderr: "Startup not supported on this OS" };
    }
    if (fs.existsSync(STARTUP_CMD)) {
      fs.unlinkSync(STARTUP_CMD);
    }
    return { ok: true, stdout: "Startup cmd removed", stderr: "" };
  } catch (e) {
    return { ok: false, stdout: "", stderr: String(e) };
  }
}

// --- ROUTES ---
app.get("/", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(__dirname, "..", "dist", "index.html");
    return res.sendFile(distPath);
  }
  res.send("Robot is alive.");
});

// app.get("/admin", (req, res) => {
//   res.sendFile(path.join(__dirname, "admin.html"));
// });

app.get("/admin/startup-status", (req, res) => {
  const enabled = startupStatus();
  res.json({ ok: true, enabled });
});

app.post("/admin/toggle-startup", async (req, res) => {
  const enabled = startupStatus();

  const result = enabled ? await disableStartup() : await enableStartup();
  const nowEnabled = startupStatus();

  res.json({
    ok: result.ok,
    enabled: nowEnabled,
    stdout: result.stdout,
    stderr: result.stderr,
  });
});

app.get("/admin/config", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  const session = getShopifySession(cfg);
  const safe = { ...cfg };
  if (safe.shopify) {
    safe.shopify = {
      shopDomain: String(safe.shopify.shopDomain || "").trim() || null
    };
  }
  delete safe.shopifyOAuth;

  // v0.4: expose backend-truth enums to UI (read-only)
  res.json({
    ok: true,
    config: safe,
    shopifyConnected: !!session,
    meta: {
      contentIntents: CONTENT_INTENTS
    }
  });
});

app.get("/admin/billing/status", async (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  cfg.billing = cfg.billing || { status: "inactive", trialEndsAt: null, lastCheckAt: null, plan: BILLING_PLAN };
  cfg.devMode = cfg.devMode || { bypassBilling: false, bypassDailyLimit: false };

  const session = getShopifySession(cfg);
  const now = Date.now();
  const lastCheck = cfg.billing.lastCheckAt ? new Date(cfg.billing.lastCheckAt).getTime() : 0;
  if (session?.accessToken && now - lastCheck > 5 * 60 * 1000) {
    try {
      const subs = await fetchActiveSubscriptions(session.shopDomain, session.accessToken);
      const active = subs.find(s => String(s.status).toUpperCase() === "ACTIVE");
      if (active) {
        const trialEndsAt = computeTrialEndsAt(active.createdAt, active.trialDays);
        cfg.billing.status = (trialEndsAt && Date.now() < new Date(trialEndsAt).getTime()) ? "trial" : "active";
        cfg.billing.trialEndsAt = trialEndsAt;
      }
      cfg.billing.lastCheckAt = new Date().toISOString();
      saveConfig(cfg);
    } catch {}
  }

  const active = isBillingActive(cfg);
  return res.json({
    ok: true,
    status: cfg.billing.status,
    trialEndsAt: cfg.billing.trialEndsAt || null,
    active,
    required: !active,
    devBypass: !!cfg.devMode?.bypassBilling
  });
});

app.post("/admin/billing/start", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const session = getShopifySession(cfg);
    if (!session?.accessToken) {
      return res.status(400).json({ ok: false, error: "shopify_not_connected" });
    }
    const base = PUBLIC_BASE_URL || FRONTEND_ORIGIN || "http://localhost:8080";
    const returnUrl = `${base}/admin/billing/confirm`;
    const confirmationUrl = await createSubscription(session.shopDomain, session.accessToken, returnUrl);
    if (!confirmationUrl) {
      return res.status(500).json({ ok: false, error: "billing_unavailable" });
    }
    return res.json({ ok: true, confirmationUrl });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Billing failed") });
  }
});

app.get("/admin/billing/confirm", async (req, res) => {
  try {
    const shop = getShopFromReq(req) || String(req.query?.shop || "");
    if (!shop) return res.status(400).send("Missing shop");
    const cfg = loadConfig(shop);
    const session = getShopifySession(cfg);
    if (!session?.accessToken) return res.status(400).send("Missing session");
    const subs = await fetchActiveSubscriptions(session.shopDomain, session.accessToken);
    const active = subs.find(s => String(s.status).toUpperCase() === "ACTIVE");
    if (active) {
      const trialEndsAt = computeTrialEndsAt(active.createdAt, active.trialDays);
      cfg.billing.status = (trialEndsAt && Date.now() < new Date(trialEndsAt).getTime()) ? "trial" : "active";
      cfg.billing.trialEndsAt = trialEndsAt;
      cfg.billing.lastCheckAt = new Date().toISOString();
      saveConfig(cfg);
    }
    const redirectBase = FRONTEND_ORIGIN || "/";
    return res.redirect(`${redirectBase}/?billing=confirmed`);
  } catch (e) {
    return res.status(500).send(String(e || "Billing confirm failed"));
  }
});

app.post("/admin/dev-mode", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const bypassBilling = !!req.body?.bypassBilling;
    const bypassDailyLimit = !!req.body?.bypassDailyLimit;
    cfg.devMode = { bypassBilling, bypassDailyLimit };
    saveConfig(cfg);
    return res.json({ ok: true, devMode: cfg.devMode });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Dev mode update failed") });
  }
});

app.post("/admin/timezone", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const timezone = String(req.body?.timezone || "").trim();
    if (!timezone) {
      return res.status(400).json({ ok: false, error: "Missing timezone" });
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid timezone" });
    }
    cfg.timezone = timezone;
    saveConfig(cfg);
    return res.json({ ok: true, timezone });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Timezone update failed") });
  }
});

// Shopify context (v0.4 contract) â€” read-only
app.get("/admin/shopify/context", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const session = getShopifySession(cfg);

    if (!session) {
      return res.json({ ok: true, connected: false, context: null });
    }

    const query = `
      query {
        shop {
          name
          primaryDomain { url host }
          myshopifyDomain
        }
        products(first: 50) {
          edges {
            node {
              id
              title
              productType
              vendor
            }
          }
        }
        collections(first: 50) {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `;

    const r = await fetch(`https://${session.shopDomain}/admin/api/2025-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
"X-Shopify-Access-Token": session.accessToken
      },
      body: JSON.stringify({ query })
    });

    const json = await r.json().catch(() => ({}));

    if (!r.ok || json.errors) {
      return res.status(500).json({
        ok: false,
        error: "Shopify request failed",
        detail: json
      });
    }

    const shop = json?.data?.shop || null;

    const products = (json?.data?.products?.edges || [])
      .map(e => e?.node)
      .filter(Boolean)
      .map(p => ({
        id: p.id,
        title: p.title,
        productType: p.productType,
        vendor: p.vendor
      }));

    const collections = (json?.data?.collections?.edges || [])
      .map(e => e?.node)
      .filter(Boolean)
      .map(c => ({
        id: c.id,
        title: c.title
      }));

    return res.json({
      ok: true,
      connected: true,
      context: {
        shop: shop
          ? {
              name: shop.name,
              domain: shop.primaryDomain?.host || shop.myshopifyDomain || null
            }
          : null,
        products,
        collections
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

app.get("/admin/shopify/products", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const session = getShopifySession(cfg);
    if (!session) {
      return res.json({ ok: true, connected: false, products: [] });
    }
    const items = await getProductCatalog(cfg, session);
    return res.json({ ok: true, connected: true, products: items });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// Shopify insights (v0.4.2) â€” aggregated business/customer snapshot (NO PII)
app.get("/admin/shopify/insights", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const session = getShopifySession(cfg);

    if (!session) {
      return res.json({ ok: true, connected: false, insights: null });
    }

    // Pull enough to infer customers + buying patterns without storing PII
    // NOTE: Shopify Admin GraphQL supports pagination; v0.4.2 keeps it small + safe.
    const query = `
      query Insights {
        shop {
          name
          myshopifyDomain
          primaryDomain { host }
          currencyCode
        }

        products(first: 100) {
          edges {
            node {
              id
              title
              productType
              vendor
              totalInventory
              variants(first: 50) {
                edges {
                  node {
                    id
                    price
                    compareAtPrice
                    sku
                  }
                }
              }
            }
          }
        }

        collections(first: 50) {
          edges { node { id title } }
        }

        orders(first: 250, sortKey: PROCESSED_AT, reverse: true)
          edges {
            node {
              id
              processedAt
              totalPriceSet { shopMoney { amount currencyCode } }
              discountApplications(first: 10) {
                edges {
                  node {
                    __typename
                  }
                }
              }
              customer {
                id
              }
              shippingAddress {
                countryCodeV2
                provinceCode
              }
              lineItems(first: 50) {
                edges {
                  node {
                    title
                    quantity
                    variant {
                      id
                      product {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const r = await fetch(`https://${session.shopDomain}/admin/api/2025-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken
      },
      body: JSON.stringify({ query })
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok || json.errors) {
      return res.status(500).json({
        ok: false,
        error: "Shopify request failed",
        detail: json
      });
    }

    const shop = json?.data?.shop || null;

    const products = (json?.data?.products?.edges || [])
      .map(e => e?.node)
      .filter(Boolean);

    const collections = (json?.data?.collections?.edges || [])
      .map(e => e?.node)
      .filter(Boolean);

    const orders = (json?.data?.orders?.edges || [])
      .map(e => e?.node)
      .filter(Boolean);

    // ---- Aggregations (NO PII) ----

    // Product categories (types, vendors, collections)
    const productTypes = {};
    const vendors = {};
    const pricePoints = [];

    for (const p of products) {
      const pt = String(p.productType || "").trim();
      if (pt) productTypes[pt] = (productTypes[pt] || 0) + 1;

      const v = String(p.vendor || "").trim();
      if (v) vendors[v] = (vendors[v] || 0) + 1;

      const variantEdges = p?.variants?.edges || [];
      for (const ve of variantEdges) {
        const price = Number(ve?.node?.price);
        if (Number.isFinite(price)) pricePoints.push(price);
      }
    }

    pricePoints.sort((a, b) => a - b);
    const median = (arr) => {
      if (!arr.length) return null;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    };

    const priceSummary = {
      min: pricePoints.length ? pricePoints[0] : null,
      median: median(pricePoints),
      max: pricePoints.length ? pricePoints[pricePoints.length - 1] : null
    };

    // Orders: AOV + repeat rate proxy + geo + top items + bought-together
    let orderCount = 0;
    let revenue = 0;

    const customersSeen = new Map(); // customerId -> count
    const geo = {};                 // "US-CA" or "US" -> count
    const topItems = {};            // title -> qty
    const pairCounts = {};          // "a|||b" -> count
    let discountedOrders = 0;

    for (const o of orders) {
      orderCount++;

      const amt = Number(o?.totalPriceSet?.shopMoney?.amount);
      if (Number.isFinite(amt)) revenue += amt;

      const custId = String(o?.customer?.id || "").trim();
      if (custId) customersSeen.set(custId, (customersSeen.get(custId) || 0) + 1);

      const cc = String(o?.shippingAddress?.countryCodeV2 || "").trim();
      const prov = String(o?.shippingAddress?.provinceCode || "").trim();
      const geoKey = cc ? (prov ? `${cc}-${prov}` : cc) : null;
      if (geoKey) geo[geoKey] = (geo[geoKey] || 0) + 1;

      const discEdges = o?.discountApplications?.edges || [];
      if (discEdges.length > 0) discountedOrders++;

      const items = (o?.lineItems?.edges || [])
        .map(e => e?.node)
        .filter(Boolean);

      const titles = [];
      for (const it of items) {
        const t = String(it.title || "").trim();
        const q = Number(it.quantity || 0);
        if (t && Number.isFinite(q)) {
          topItems[t] = (topItems[t] || 0) + q;
          titles.push(t);
        }
      }

      // bought-together pairs (unique per order)
      const uniqueTitles = Array.from(new Set(titles.map(x => x.toLowerCase())))
        .map(lower => titles.find(t => t.toLowerCase() === lower))
        .filter(Boolean);

      uniqueTitles.sort((a, b) => a.localeCompare(b));
      for (let i = 0; i < uniqueTitles.length; i++) {
        for (let j = i + 1; j < uniqueTitles.length; j++) {
          const a = uniqueTitles[i];
          const b = uniqueTitles[j];
          const key = `${a}|||${b}`;
          pairCounts[key] = (pairCounts[key] || 0) + 1;
        }
      }
    }

    const aov = orderCount > 0 ? (revenue / orderCount) : null;

    let repeatCustomers = 0;
    let uniqueCustomers = 0;
    for (const [, cnt] of customersSeen.entries()) {
      uniqueCustomers++;
      if (cnt >= 2) repeatCustomers++;
    }
    const repeatRate = uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers) : null;

    const sortTop = (obj, limit = 10) =>
      Object.entries(obj)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([k, v]) => ({ name: k, value: v }));

    const topProductsByQty = sortTop(topItems, 12);

    const topPairs = Object.entries(pairCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([k, v]) => {
        const [a, b] = k.split("|||");
        return { a, b, count: v };
      });

    const geoTop = sortTop(geo, 10);

    const insights = {
      shop: shop ? {
        name: shop.name,
        domain: shop.primaryDomain?.host || shop.myshopifyDomain || null,
        currencyCode: shop.currencyCode || null
      } : null,

      catalog: {
        collections: collections.map(c => ({ id: c.id, title: c.title })),
        productTypeTop: sortTop(productTypes, 10),
        vendorTop: sortTop(vendors, 10),
        priceSummary
      },

      orders: {
        sampleSize: orderCount,
        revenueSample: Number.isFinite(revenue) ? revenue : null,
        aov,
        discountedOrderRate: orderCount > 0 ? (discountedOrders / orderCount) : null,
        repeatRate,
        topProductsByQty,
        topPairs,
        geoTop
      }
    };

    return res.json({ ok: true, connected: true, insights });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// Shopify autopopulate â€” fills setup wizard defaults from Shopify (only if empty)
app.post("/admin/setup/autopopulate", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const session = getShopifySession(cfg);

    if (!session) {
      return res.status(400).json({ ok: false, error: "Not connected to Shopify" });
    }

    // Pull minimal context for setup defaults
    const query = `
      query {
        shop {
          name
          primaryDomain { url host }
          myshopifyDomain
        }
        products(first: 50) {
          edges {
            node {
              id
              title
              productType
              vendor
            }
          }
        }
        collections(first: 50) {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `;

    const r = await fetch(`https://${session.shopDomain}/admin/api/2025-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken
      },
      body: JSON.stringify({ query })
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok || json.errors) {
      return res.status(500).json({
        ok: false,
        error: "Shopify request failed",
        detail: json
      });
    }

    const shop = json?.data?.shop || null;

    const products = (json?.data?.products?.edges || [])
      .map(e => e?.node)
      .filter(Boolean);

    const collections = (json?.data?.collections?.edges || [])
      .map(e => e?.node)
      .filter(Boolean);

    // Build a simple products/services string for the wizard
    const productTitles = products.map(p => String(p.title || "").trim()).filter(Boolean);
    const collectionTitles = collections.map(c => String(c.title || "").trim()).filter(Boolean);

    const combined = [...productTitles, ...collectionTitles]
      .map(s => s.trim())
      .filter(Boolean);

    // De-dupe while preserving order
    const seen = new Set();
    const uniqueCombined = combined.filter(x => {
      if (seen.has(x.toLowerCase())) return false;
      seen.add(x.toLowerCase());
      return true;
    });

    let suggestedList = uniqueCombined.slice(0, 80);

    // Heuristic filter to drop obvious garbage fragments
    const stop = new Set([
      "and",
      "or",
      "with",
      "the",
      "a",
      "an",
      "bold",
      "flavorful",
      "energy",
      "focus",
      "wellness",
      "boost",
      "power",
      "performance",
      "support",
      "relief",
      "daily",
      "natural",
      "organic"
    ]);
    suggestedList = suggestedList.filter(item => {
      const t = String(item || "").trim();
      if (!t) return false;
      if (t.length < 2) return false;
      const lower = t.toLowerCase();
      if (stop.has(lower)) return false;
      if (lower.startsWith("and ")) return false;
      if (lower.startsWith("or ")) return false;
      return true;
    });

    const originalSet = new Set(suggestedList.map(s => s.toLowerCase()));

    // AI clean list (best-effort)
    const cleanedList = await cleanListAI({
      field: "products",
      items: suggestedList,
      maxItems: 60
    });

    const filteredCleaned = cleanedList.filter(item => {
      const lower = String(item || "").toLowerCase().trim();
      if (!lower) return false;
      if (stop.has(lower)) return false;
      if (lower.startsWith("and ") || lower.startsWith("or ")) return false;
      if (originalSet.has(lower)) return true;
      return lower.split(/\s+/).length >= 2;
    });

    const finalList = filteredCleaned.length ? filteredCleaned : suggestedList.slice(0, 60);
    const suggestedProductsRaw = finalList.join(", ");

    // Write into businessContext ONLY if empty (no overwrites)
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";

    if (!String(cfg.businessContext.business_name || "").trim() && shop?.name) {
      cfg.businessContext.business_name = shop.name;
    }

    if (!String(cfg.businessContext.products_raw || "").trim() && suggestedProductsRaw) {
      cfg.businessContext.products_raw = suggestedProductsRaw;
    }

    // Suggest industry (best-effort, AI) if missing
    if (!String(cfg.businessContext.industry || "").trim()) {
      const industrySeed =
        `Products: ${productTitles.slice(0, 20).join(", ")}. ` +
        `Collections: ${collectionTitles.slice(0, 20).join(", ")}.`;
      const inferred = await inferIndustryAI(industrySeed);
      if (inferred) {
        cfg.businessContext.industry = inferred;
      }
    }

    // Set setupStep based on whatâ€™s still missing
    const hasName = !!String(cfg.businessContext.business_name || "").trim();
    const hasIndustry = !!String(cfg.businessContext.industry || "").trim();
    const hasProducts = !!String(cfg.businessContext.products_raw || "").trim();

    if (!hasName) cfg.businessContext.setupStep = 1;
    else if (!hasIndustry) cfg.businessContext.setupStep = 2;
    else if (!hasProducts) cfg.businessContext.setupStep = 3;
    else cfg.businessContext.setupStep = 4;

    saveConfig(cfg);

    // System log (diagnostic truth)
    logSystem(ctx.shop, { type: "shopify_autopopulate" });

    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// v0.4.2 â€” Target customer suggestion (NO PII). Stores suggestion separately.
// Uses Shopify insights + optional AI (if enabled via body.ai === true).
app.post("/admin/setup/suggest/target-customer", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const session = getShopifySession(cfg);

    if (!session) {
      return res.status(400).json({ ok: false, error: "Not connected to Shopify" });
    }

    // Pull insights from our own endpoint logic (duplicate minimal query to avoid internal HTTP calls)
    const query = `
      query Insights {
        shop {
          name
          myshopifyDomain
          primaryDomain { host }
          currencyCode
        }

        products(first: 100) {
          edges {
            node {
              id
              title
              productType
              vendor
              variants(first: 50) {
                edges { node { price } }
              }
            }
          }
        }

        orders(first: 250, sortKey: PROCESSED_AT, reverse: true) {
          edges {
            node {
              id
              totalPriceSet { shopMoney { amount currencyCode } }
              discountApplications(first: 10) { edges { node { __typename } } }
              customer { id }
              shippingAddress { countryCodeV2 provinceCode }
              lineItems(first: 50) { edges { node { title quantity } } }
            }
          }
        }
      }
    `;

    const r = await fetch(`https://${session.shopDomain}/admin/api/2025-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken
      },
      body: JSON.stringify({ query })
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok || json.errors) {
      return res.status(500).json({
        ok: false,
        error: "Shopify request failed",
        detail: json
      });
    }

    const shop = json?.data?.shop || null;
    const orders = (json?.data?.orders?.edges || []).map(e => e?.node).filter(Boolean);
    const products = (json?.data?.products?.edges || []).map(e => e?.node).filter(Boolean);

    // --- build tiny facts object (NO PII) ---
    let revenue = 0;
    let discountedOrders = 0;

    const customersSeen = new Map(); // id -> count
    const geo = {};                 // "US-NY" -> count
    const topItems = {};            // title -> qty
    const productTypes = {};        // type -> count

    for (const p of products) {
      const pt = String(p.productType || "").trim();
      if (pt) productTypes[pt] = (productTypes[pt] || 0) + 1;
    }

    for (const o of orders) {
      const amt = Number(o?.totalPriceSet?.shopMoney?.amount);
      if (Number.isFinite(amt)) revenue += amt;

      const discEdges = o?.discountApplications?.edges || [];
      if (discEdges.length > 0) discountedOrders++;

      const custId = String(o?.customer?.id || "").trim();
      if (custId) customersSeen.set(custId, (customersSeen.get(custId) || 0) + 1);

      const cc = String(o?.shippingAddress?.countryCodeV2 || "").trim();
      const prov = String(o?.shippingAddress?.provinceCode || "").trim();
      const geoKey = cc ? (prov ? `${cc}-${prov}` : cc) : null;
      if (geoKey) geo[geoKey] = (geo[geoKey] || 0) + 1;

      const items = (o?.lineItems?.edges || []).map(e => e?.node).filter(Boolean);
      for (const it of items) {
        const t = String(it.title || "").trim();
        const q = Number(it.quantity || 0);
        if (t && Number.isFinite(q)) topItems[t] = (topItems[t] || 0) + q;
      }
    }

    const orderCount = orders.length;
    const aov = orderCount > 0 ? (revenue / orderCount) : null;

    let repeatCustomers = 0;
    let uniqueCustomers = 0;
    for (const [, cnt] of customersSeen.entries()) {
      uniqueCustomers++;
      if (cnt >= 2) repeatCustomers++;
    }
    const repeatRate = uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers) : null;

    const sortTop = (obj, limit = 5) =>
      Object.entries(obj)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([k, v]) => ({ name: k, value: v }));

    const facts = {
      shopName: shop?.name || null,
      domain: shop?.primaryDomain?.host || shop?.myshopifyDomain || null,
      orderCount,
      aov,
      discountedOrderRate: orderCount > 0 ? (discountedOrders / orderCount) : null,
      repeatRate,
      topItems: sortTop(topItems, 6),
      topGeo: sortTop(geo, 5),
      topProductTypes: sortTop(productTypes, 6)
    };

    // --- suggestion ---
    // Default: deterministic heuristic (no AI)
    let suggestion =
      `Health-conscious shoppers interested in functional mushrooms (especially mushroom coffee/tea) ` +
      `who want everyday energy/focus support and convenient formats (coffee, tea, gummies).`;

    // Optional: AI refinement (body.ai === true)
    const useAI = req.body?.ai === true;

    if (useAI) {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
      }

      const prompt = `
You are helping write a SINGLE target-customer statement for an e-commerce store.
Use ONLY the provided facts. Do NOT invent demographics you cannot support.
Do NOT include any personally identifying information.

Facts (JSON):
${JSON.stringify(facts)}

Write 1-2 sentences that describe the most likely target customer.
Keep it concrete and useful for marketing + blog writing.
Return ONLY valid JSON:
{ "target_customer": "..." }
`;

      const resp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          input: prompt
        })
      });

      const data = await resp.json().catch(() => ({}));
      const text =
        (data.output_text ||
          data.output?.[0]?.content?.[0]?.text ||
          "").trim();

      const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();

      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      const chunk = (start !== -1 && end !== -1 && end > start)
        ? cleaned.slice(start, end + 1)
        : cleaned;

      try {
        const parsed = JSON.parse(chunk);
        const tc = String(parsed?.target_customer || "").trim();
        if (tc) suggestion = tc;
      } catch {
        // keep heuristic suggestion if AI response is malformed
      }
    }

    // Persist suggestion WITHOUT overwriting user-authored target_customer
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";

    cfg.businessContext.target_customer_suggested = suggestion;
    cfg.businessContext.target_customer_suggested_at = new Date().toISOString();
    cfg.businessContext.target_customer_facts = facts; // helpful for blog writing later (NO PII)

    saveShopifyInsightsSnapshot(ctx.shop, facts);
    saveConfig(cfg);

    logSystem(ctx.shop, { type: "suggest_target_customer", ai: useAI });

    return res.json({
      ok: true,
      facts,
      suggested: suggestion,
      config: loadConfig(ctx.shop)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// Shopify disconnect (local logout) â€” clears only the Shopify session
app.post("/admin/shopify/disconnect", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;

    // Remove Shopify session only
    delete cfg.shopify;

    saveConfig(cfg);

    // System log (diagnostic truth)
    logSystem(ctx.shop, { type: "shopify_disconnect" });
    clearShopCookie(res);

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// v0.3 setup wizard â€” Step 1: save business_name
app.post("/admin/setup/step1", (req, res) => {
  try {
    const name = String(req.body?.business_name || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "business_name is required" });

    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";
    cfg.businessContext.business_name = name;
cfg.businessContext.setupStep = 2;

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// v0.3 setup wizard â€” Step 2: save industry
app.post("/admin/setup/step2", (req, res) => {
  try {
    const industry = String(req.body?.industry || "").trim();
    if (!industry) return res.status(400).json({ ok: false, error: "industry is required" });

    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";

    cfg.businessContext.industry = industry;
cfg.businessContext.setupStep = 3;

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// v0.3 setup wizard â€” Step 3: save products/services
// v0.3 setup wizard â€” Step 3: save products/services (+ excluded topics)
app.post("/admin/setup/step3", (req, res) => {
  try {
    const raw = String(req.body?.products || "").trim();
    if (!raw) return res.status(400).json({ ok: false, error: "products is required" });

    // Excluded topics (optional)
// Accept either:
// - excludedTopics: ["a","b"]
// - excludedTopics: "a, b"  (comma or newline separated)
const incoming = req.body?.excludedTopics;
let cleaned = [];

if (Array.isArray(incoming)) {
  cleaned = incoming
    .map(x => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 100);
} else if (typeof incoming === "string") {
  cleaned = incoming
    .split(/\r?\n|,/g)
    .map(x => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 100);
}

    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";

    cfg.businessContext.products_raw = raw;

    // Persist excluded topics at root (authoritative)
    cfg.excludedTopics = cleaned;

    cfg.businessContext.setupStep = 4;

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

app.post("/admin/setup/suggest-target-customer", async (req, res) => {
  let ctx;
  try {
    ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.businessContext = cfg.businessContext || {};

    const bc = cfg.businessContext || {};
    const businessName = String(bc.business_name || "").trim();
    const industry = String(bc.industry || "").trim();
    const productsRaw = String(bc.products || bc.products_raw || "").trim();

    // If user already has one and we aren't forcing, return it.
    const force = req.body && req.body.force === true;
    if (!force && String(bc.target_customer || "").trim()) {
      return res.json({ ok: true, target_customer: bc.target_customer, reused: true });
    }

    // Deterministic fallback (always works)
    const fallback =
      `${businessName || "This store"} serves health-conscious shoppers who want ` +
      `everyday focus/energy support and prefer convenient functional mushroom products ` +
      `(e.g., coffee, gummies, capsules).`;

    // Try to enrich prompt with Shopify context (best-effort)
    const session = getShopifySession(cfg);

    let shopName = "";
    let shopDomain = "";
    let productTitles = [];
    let productTypes = [];
    let collectionTitles = [];

    if (session) {
      try {
        const q = `
          query {
            shop { name myshopifyDomain primaryDomain { host } }
            products(first: 20, sortKey: UPDATED_AT, reverse: true) {
              edges { node { title productType vendor } }
            }
            collections(first: 20, sortKey: UPDATED_AT, reverse: true) {
              edges { node { title } }
            }
          }
        `;

        const r = await fetch(`https://${session.shopDomain}/admin/api/2025-07/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken
          },
          body: JSON.stringify({ query: q })
        });

        const j = await r.json().catch(() => ({}));
        const s = j?.data?.shop || null;

        shopName = s?.name || "";
        shopDomain = s?.primaryDomain?.host || s?.myshopifyDomain || "";

        const ps = (j?.data?.products?.edges || []).map(e => e?.node).filter(Boolean);
        productTitles = ps.map(p => p.title).filter(Boolean).slice(0, 12);
        productTypes = [...new Set(ps.map(p => p.productType).filter(Boolean))].slice(0, 8);

        const cs = (j?.data?.collections?.edges || []).map(e => e?.node).filter(Boolean);
        collectionTitles = cs.map(c => c.title).filter(Boolean).slice(0, 10);
      } catch {
        // best-effort only
      }
    }

    // If no OpenAI key, save fallback and return (no silent failure)
    if (!OPENAI_API_KEY) {
      cfg.businessContext.target_customer = fallback;
      saveConfig(cfg);
      return res.json({ ok: true, target_customer: fallback, reused: false, ai: false });
    }

    const prompt = `
You are helping configure an automated content system for a business.

Task:
Generate a strong "Target customer" description for the business.
This must be specific and useful for writing content, not vague.

Rules:
- Output MUST be a single line (no bullets).
- Max 220 characters.
- Plain language.
- Prefer: demographic/role + intent/problem + product fit.
- Do NOT mention "Shopify", "GPT", "AI", or "Cartwheel".
- Do NOT use quotes.

Business context:
- Business name: ${businessName || "â€”"}
- Industry: ${industry || "â€”"}
- Products/services (owner-entered): ${productsRaw || "â€”"}

Shop context (if available):
- Shop name: ${shopName || "â€”"}
- Shop domain: ${shopDomain || "â€”"}
- Recent products: ${productTitles.length ? productTitles.join(", ") : "â€”"}
- Product types: ${productTypes.length ? productTypes.join(", ") : "â€”"}
- Collections: ${collectionTitles.length ? collectionTitles.join(", ") : "â€”"}

Return ONLY the final Target customer line.
`.trim();

    const oai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        temperature: 0.2,
        max_output_tokens: 120
      })
    });

    const oj = await oai.json().catch(() => ({}));

    const out = String(
      oj?.output_text ||
      oj?.output?.[0]?.content?.[0]?.text ||
      ""
    ).trim();

    // If OpenAI fails or returns empty, fall back (and still populate)
    const finalLine = (oai.ok && out) ? out : fallback;

    cfg.businessContext.target_customer = finalLine;
    saveConfig(cfg);

    return res.json({
      ok: true,
      target_customer: finalLine,
      reused: false,
      ai: (oai.ok && !!out)
    });
  } catch (e) {
    // Even on exception, still populate deterministically
    try {
      if (!ctx) {
        return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
      }
      const cfg = loadConfig(ctx.shop);
      cfg.businessContext = cfg.businessContext || {};
      const bc = cfg.businessContext || {};
      const businessName = String(bc.business_name || "").trim();

      const fallback =
        `${businessName || "This store"} serves health-conscious shoppers who want ` +
        `everyday focus/energy support and prefer convenient functional mushroom products ` +
        `(e.g., coffee, gummies, capsules).`;

      cfg.businessContext.target_customer = fallback;
      saveConfig(cfg);

      return res.json({ ok: true, target_customer: fallback, reused: false, ai: false });
    } catch {
      return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
    }
  }
});

// v0.3 setup wizard â€” Step 4: save target customer
app.post("/admin/setup/step4", (req, res) => {
  try {
    const target_customer = String(req.body?.target_customer || "").trim();
    if (!target_customer) return res.status(400).json({ ok: false, error: "target_customer is required" });

    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";

    cfg.businessContext.target_customer = target_customer;
    cfg.businessContext.setupStep = 5;

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// v0.3 setup wizard â€” Step 5: save content goals
app.post("/admin/setup/step5", (req, res) => {
  try {
    const goals = req.body?.goals;
    if (!goals || typeof goals !== "object") {
      return res.status(400).json({ ok: false, error: "goals is required" });
    }

    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";

    cfg.businessContext.goals = {
      traffic: goals.traffic === true,
      sales: goals.sales === true,
      authority: goals.authority === true
    };

    cfg.businessContext.setupStep = 6;

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// v0.3 setup wizard â€” Step 6: save content intent default
app.post("/admin/setup/intent", (req, res) => {
  try {
    const intent = normalizeContentIntent(req.body?.intent || "informational");
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";

    cfg.contentIntentDefault = intent;
    cfg.businessContext.content_intent_default = intent;
    cfg.businessContext.setupStep = 7;

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// v0.3 setup wizard â€” Step 7: save posting tone
app.post("/admin/setup/step6", (req, res) => {
  try {
    const tone = String(req.body?.tone || "").trim();
    if (!tone) return res.status(400).json({ ok: false, error: "tone is required" });

    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";

    cfg.businessContext.tone = tone;
    cfg.businessContext.setupStep = 8;

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// v0.3 setup wizard â€” Back: step-1 (min 1)
app.post("/admin/setup/back", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.businessContext = cfg.businessContext || {};
    if (!cfg.businessContext.status) cfg.businessContext.status = "uninitialized";

    const cur = Number(cfg.businessContext.setupStep ?? 1);
    const next = Math.max(1, cur - 1);

    cfg.businessContext.setupStep = next;

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// v0.3 setup wizard: begin (Step 0 -> Step 1)
app.post("/admin/setup/begin", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;

    cfg.businessContext = cfg.businessContext || {};
    cfg.businessContext.status = cfg.businessContext.status || "uninitialized";
    cfg.businessContext.setupStep = 1;

    saveConfig(cfg);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "begin failed") });
  }
});

// v0.3 setup wizard: restart (authoritative reset)
app.post("/admin/setup/restart", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;

    // Hard reset business context
    cfg.businessContext = {
      status: "uninitialized",
      setupStep: 0
      // intentionally clearing previous inputs
    };

cfg.excludedTopics = [];

    // Authoritative gates
    cfg._postingBlocked = true;

    cfg.topicGen = cfg.topicGen || {};
    cfg.topicGen.enabled = false;

cfg.excludedTopics = [];

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "restart failed") });
  }
});

// v0.3 setup wizard â€” Finish: mark business context initialized (authoritative)
app.post("/admin/setup/finish", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;

    cfg.businessContext = cfg.businessContext || {};

    // Mark setup complete
    cfg.businessContext.status = "initialized";
    cfg.businessContext.setupStep = 7;

    // Authoritative unlocks
    cfg._postingBlocked = false;

    cfg.topicGen = cfg.topicGen || {};
    cfg.topicGen.enabled = true;

    saveConfig(cfg);
    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

app.get("/admin/clock", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  const tz = (cfg && cfg.timezone) ? cfg.timezone : "America/New_York";

  const now = new Date();

  let local = "";
  try {
    local = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    // if timezone is invalid, fall back to system local formatting
    local = now.toLocaleString();
  }

  res.json({
    ok: true,
    tz,
    nowIso: now.toISOString(),
    nowLocal: local,
    nowMs: Date.now(),
  });
});

app.get("/admin/scheduler-status", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const status = schedulerStatusByShop.get(ctx.shop) || "ready";
  res.json({ ok: true, schedulerStatus: status });
});

app.get("/admin/activity", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const activity = loadActivity(ctx.shop);
  res.json({ ok: true, activity });
});

// System log (long-term) â€” read-only
app.get("/admin/system-log", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    let raw = "";
    if (dbEnabled()) {
      raw = dbGetSystemLog(ctx.shop) || "";
    } else {
      const logPath = systemLogPathFor(ctx.shop);
      if (!fs.existsSync(logPath)) {
        return res.json({ ok: true, lines: [] });
      }
      raw = fs.readFileSync(logPath, "utf-8");
    }
    const lines = raw.split("\n").filter(Boolean).slice(-500);

    return res.json({ ok: true, lines });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

app.post("/admin/toggle-mode", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  cfg.mode = cfg.mode === "draft" ? "live" : "draft";
  saveConfig(cfg);
  res.json({ ok: true, mode: cfg.mode });
});

app.post("/admin/mode", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    const mode = String(req.body?.mode || "").toLowerCase();
    if (mode !== "live" && mode !== "draft") {
      return res.status(400).json({ ok: false, error: "Invalid mode" });
    }
    cfg.mode = mode;
    saveConfig(cfg);
    return res.json({ ok: true, mode: cfg.mode });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Mode update failed") });
  }
});

app.post("/admin/toggle-robot", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;

  // default to true if missing (fails safe = robot runs unless explicitly disabled)
  if (typeof cfg.robotEnabled !== "boolean") cfg.robotEnabled = true;

  cfg.robotEnabled = !cfg.robotEnabled;
  saveConfig(cfg);

  res.json({ ok: true, robotEnabled: cfg.robotEnabled });
});

app.post("/admin/daily-limit", (req, res) => {
  try {
    const maxPerDay = Number(req.body?.maxPerDay);
    if (!Number.isFinite(maxPerDay) || maxPerDay <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid maxPerDay" });
    }

    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.dailyLimit = cfg.dailyLimit || { enabled: true, maxPerDay: 6 };
    cfg.dailyLimit.enabled = true;
    cfg.dailyLimit.maxPerDay = Math.floor(maxPerDay);
    saveConfig(cfg);

    return res.json({ ok: true, dailyLimit: cfg.dailyLimit });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// Reset everything to defaults (clears logs, topics, schedules, setup)
app.post("/admin/reset-all", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;

    cfg.mode = "live";
    cfg.timezone = cfg.timezone || "America/New_York";
    cfg.uiDevMode = cfg.uiDevMode === true;
    cfg.robotEnabled = true;

    cfg.dailyLimit = { enabled: true, maxPerDay: 3, devBypass: false };
    cfg.dailyUsage = { dayKey: getTodayKey(cfg.timezone), count: 0 };

    cfg.schedules = [
      { enabled: true, daysOfWeek: ["Mon"], times: ["09:00"], mode: "live" }
    ];
    cfg.schedule = { daysOfWeek: ["Mon"], time: "09:00" };

    cfg.topics = [];
    cfg.topicArchive = [];
    cfg.topicGen = { enabled: true, minTopics: 3, batchSize: 5, includeProductPosts: false };
    cfg.topicStrategy = "queue";
    cfg.previewCache = cfg.previewCache || {};
    cfg.contentIntentDefault = "informational";

    cfg.lastRun = null;
    cfg.lastPost = null;

    cfg.businessContext = { status: "uninitialized", setupStep: 0 };
    cfg._postingBlocked = true;
    cfg.excludedTopics = [];
    cfg.billing = { status: "inactive", trialEndsAt: null, lastCheckAt: null, plan: BILLING_PLAN };
    cfg.devMode = { bypassBilling: false, bypassDailyLimit: false };

    // Disconnect Shopify on reset
    delete cfg.shopify;
    delete cfg.shopifyOAuth;

    saveConfig(cfg);

    schedulerStatusByShop.delete(ctx.shop);
    lastPostDayByShop.delete(ctx.shop);
    postedTimesByShop.delete(ctx.shop);

    // Clear activity + system logs
    if (dbEnabled()) {
      try { dbClearActivity(ctx.shop); } catch {}
      try { dbClearSystemLog(ctx.shop); } catch {}
    } else {
      try { fs.writeFileSync(activityPathFor(ctx.shop), "[]", "utf-8"); } catch {}
      try { fs.writeFileSync(systemLogPathFor(ctx.shop), "", "utf-8"); } catch {}
    }

    return res.json({ ok: true, config: loadConfig(ctx.shop) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

app.post("/admin/update-schedule", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;

  // NEW: bulk profiles save
  if (Array.isArray(req.body?.profiles)) {
    const profiles = req.body.profiles.map(p => ({
      enabled: (p && typeof p.enabled === "boolean") ? p.enabled : true,
      daysOfWeek: Array.isArray(p?.daysOfWeek) ? p.daysOfWeek.map(d => String(d).trim()).filter(Boolean) : [],
      times: Array.isArray(p?.times) ? p.times.map(t => String(t).trim()).filter(Boolean) : [],
      mode: p?.mode === "draft" ? "draft" : "live"
    }));

    cfg.schedules = profiles;

    // Keep legacy cfg.schedule in sync with Profile 1 (compat)
    const p0 = cfg.schedules[0] || { daysOfWeek: [], times: [] };
    cfg.schedule = {
      daysOfWeek: p0.daysOfWeek,
      time: (p0.times || []).join(", ")
    };

    saveConfig(cfg);
    return res.json({ ok: true, schedules: cfg.schedules });
  }

  // LEGACY: single schedule save (treat as Profile 1)
  const { daysOfWeek, time } = req.body;

  if (!Array.isArray(daysOfWeek) || !time) {
    return res.status(400).json({ ok: false, error: "Invalid schedule data" });
  }

  const p0 = {
    enabled: true,
    daysOfWeek: daysOfWeek.map(d => String(d).trim()).filter(Boolean),
    times: String(time).split(",").map(t => String(t).trim()).filter(Boolean)
  };

  cfg.schedules = Array.isArray(cfg.schedules) && cfg.schedules.length ? cfg.schedules : [p0];
  cfg.schedules[0] = p0;

  // legacy sync
  cfg.schedule = {
    daysOfWeek: p0.daysOfWeek,
    time: (p0.times || []).join(", ")
  };

  saveConfig(cfg);
  res.json({ ok: true, schedule: cfg.schedule, schedules: cfg.schedules });
});

app.post("/admin/topics/generate", async (req, res) => {
  let ctx;
  try {
    ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;

    if (!process.env.OPENAI_API_KEY) {
      logActivity(ctx.shop, {
        type: "error",
        source: "manual",
        mode: cfg.mode || "draft",
        title: "Generate topics failed: Missing OPENAI_API_KEY",
      });
      return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
    }

    const newTopics = await generateTopics(cfg);

    if (!Array.isArray(newTopics) || newTopics.length === 0) {
      logActivity(ctx.shop, {
        type: "error",
        source: "manual",
        mode: cfg.mode || "draft",
        title: "Generate topics failed: OpenAI returned 0 topics",
      });
      return res.status(500).json({ ok: false, error: "No topics generated" });
    }

    cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
    cfg.topics.push(...newTopics);
    saveConfig(cfg);

    logActivity(ctx.shop, {
      type: "topics_generate",
      source: "manual",
      mode: cfg.mode || "draft",
      title: `Generated ${newTopics.length} topics`,
    });

    return res.json({
      ok: true,
      added: newTopics.length,
      topicsCount: cfg.topics.length,
    });
  } catch (e) {
    const msg = String(e);
    try {
      if (ctx) {
        const cfg = loadConfig(ctx.shop);
        logActivity(ctx.shop, {
          type: "error",
          source: "manual",
          mode: cfg.mode || "draft",
          title: `Generate topics failed: ${msg}`,
        });
      }
    } catch {}
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.get("/admin/topics", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  const topics = Array.isArray(cfg.topics) ? cfg.topics.map((t) => normalizeTopicItem(t, cfg)).filter(Boolean) : [];
  res.json({ ok: true, topics, archive: cfg.topicArchive || [] });
});

app.post("/admin/topics/add", (req, res) => {
  const { topic, intent } = req.body;
  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ ok: false, error: "Missing topic" });
  }

  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
  const normalized = normalizeTopicItem({ title: String(topic).trim(), intent }, cfg);
  if (!normalized) {
    return res.status(400).json({ ok: false, error: "Invalid topic" });
  }
  cfg.topics.push(normalized);
  saveConfig(cfg);

  res.json({ ok: true, topics: cfg.topics });
});

app.post("/admin/topics/remove", (req, res) => {
  const { index } = req.body;
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];

  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= cfg.topics.length) {
    return res.status(400).json({ ok: false, error: "Invalid index" });
  }

  const removed = cfg.topics.splice(i, 1)[0];
  saveConfig(cfg);

  (async () => {
    const autoGenerated = await maybeAutoGenerateTopics(ctx.shop, cfg);
    res.json({ ok: true, removed, topics: cfg.topics, autoGenerated: autoGenerated || 0 });
  })();
});

// Archive a topic from queue -> archive (manual)
app.post("/admin/topics/archive", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
  cfg.topicArchive = cfg.topicArchive || [];

  const index = Number(req.body?.index);
  const topicText = String(req.body?.topic || "").trim();

  let i = index;
  if (!Number.isInteger(i) || i < 0 || i >= cfg.topics.length) {
    if (topicText) {
      i = cfg.topics.findIndex(t => getTopicTitle(t) === topicText);
    }
  }

  if (!Number.isInteger(i) || i < 0 || i >= cfg.topics.length) {
    return res.status(400).json({ ok: false, error: "Invalid index/topic" });
  }

  const removed = cfg.topics.splice(i, 1)[0];
  if (removed) {
    const normalized = normalizeTopicItem(removed, cfg);
    cfg.topicArchive.push({
      topic: normalized?.title || String(removed).trim(),
      intent: normalized?.intent || normalizeContentIntent(cfg.contentIntentDefault),
      postedAt: new Date().toISOString(),
      articleId: null
    });
  }

  saveConfig(cfg);
  (async () => {
    const autoGenerated = await maybeAutoGenerateTopics(ctx.shop, cfg);
    res.json({
      ok: true,
      removed,
      topics: cfg.topics,
      archive: cfg.topicArchive,
      autoGenerated: autoGenerated || 0
    });
  })();
  return;
});

// Release archive back into queue (preserve order) and clear archive
app.post("/admin/topics/release-archive", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
    cfg.topicArchive = Array.isArray(cfg.topicArchive) ? cfg.topicArchive : [];

    const archivedTopics = cfg.topicArchive
      .map(a => normalizeTopicItem({ title: a?.topic || a?.title || "", intent: a?.intent }, cfg))
      .filter(Boolean);

    cfg.topics.push(...archivedTopics);
    cfg.topicArchive = [];

    saveConfig(cfg);
    return res.json({ ok: true, topics: cfg.topics, archive: cfg.topicArchive });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

app.post("/admin/topicgen/update", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;

    const minTopicsRaw = req.body?.minTopics;
    const batchSizeRaw = req.body?.batchSize;
    const includeProductPostsRaw = req.body?.includeProductPosts;

    const minTopics = Math.max(0, Math.min(1000, Number(minTopicsRaw)));
    const batchSize = Math.max(1, Math.min(30, Number(batchSizeRaw))); // reasonable hard max = 30

    if (!Number.isFinite(minTopics) || !Number.isFinite(batchSize)) {
      return res.status(400).json({ ok: false, error: "Invalid number" });
    }

    cfg.topicGen = cfg.topicGen || {};
    cfg.topicGen.minTopics = minTopics;
    cfg.topicGen.batchSize = batchSize;
    if (typeof includeProductPostsRaw !== "undefined") {
      cfg.topicGen.includeProductPosts = !!includeProductPostsRaw;
    }

    saveConfig(cfg);
    (async () => {
      const autoGenerated = await maybeAutoGenerateTopics(ctx.shop, cfg);
      res.json({ ok: true, topicGen: cfg.topicGen, autoGenerated: autoGenerated || 0 });
    })();
    return;
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

app.post("/admin/topicgen/toggle", (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = ctx.cfg;
    cfg.topicGen = cfg.topicGen || {};
    cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];

    const cur = cfg.topicGen.enabled !== false; // default true
    cfg.topicGen.enabled = !cur;

    saveConfig(cfg);
    (async () => {
      const autoGenerated = await maybeAutoGenerateTopics(ctx.shop, cfg);
      res.json({ ok: true, enabled: cfg.topicGen.enabled, topicGen: cfg.topicGen, autoGenerated: autoGenerated || 0 });
    })();
    return;
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

app.post("/admin/topics/clear-queue", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  cfg.topics = [];
  saveConfig(cfg);

  logActivity(ctx.shop, {
    type: "queue_clear",
    source: "manual",
    mode: cfg.mode || "draft",
    title: "Cleared topic queue",
  });

  (async () => {
    const autoGenerated = await maybeAutoGenerateTopics(ctx.shop, cfg);
    res.json({ ok: true, topicsCount: 0, autoGenerated: autoGenerated || 0 });
  })();
});

app.post("/admin/topics/clear-archive", (req, res) => {
  const ctx = getCfgFromReq(req, res);
  if (!ctx) return;
  const cfg = ctx.cfg;
  cfg.topicArchive = [];
  saveConfig(cfg);

  // optional: log it so itâ€™s visible in Recent Activity
  logActivity(ctx.shop, {
    type: "archive_clear",
    source: "manual",
    mode: cfg.mode || "draft",
    title: "Cleared topic archive",
  });

  res.json({ ok: true, archiveCount: 0 });
});

// Preview: generate draft content for a topic (no publish)
app.post("/admin/preview/generate", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    if (!OPENAI_API_KEY) return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });

    const topic = String(req.body?.topic || "").trim();
    if (!topic) return res.status(400).json({ ok: false, error: "Missing topic" });
    const cfg = loadConfig(ctx.shop);
    const session = getShopifySession(cfg);
    const insights = session ? await getShopifyInsightsForPrompt(cfg, session) : null;
    let relatedProducts = [];
    if (session) {
      try {
        const products = await getProductCatalog(cfg, session);
        relatedProducts = selectRelatedProducts(topic, products, 2);
      } catch {}
    }

    const prompt = `
Write a draft SEO blog post for this topic:
${topic}

Return clean markdown (no code fences). Include:
- Title
- Short intro
- 3-5 headings with short paragraphs
- A brief FAQ (3 Q/A)
Keep it helpful and not salesy.
Shopify insights (use for relevance, no PII): ${JSON.stringify(insights || cfg?.businessContext?.target_customer_facts || {})}
`.trim();

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        temperature: 0.4,
        max_output_tokens: 900,
      }),
    });

    const data = await r.json().catch(() => ({}));
    const text =
      (data.output_text ||
        data.output?.[0]?.content?.[0]?.text ||
        "").trim();

    if (!text) return res.status(500).json({ ok: false, error: "No content generated" });
    const appended = `${text}${buildProductLinkMarkdown(topic, relatedProducts)}`;
    cfg.previewCache = cfg.previewCache || {};
    cfg.previewCache[topic] = appended;
    saveConfig(cfg);
    return res.json({ ok: true, content: appended });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// Preview: apply edits based on user instruction
app.post("/admin/preview/edit", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    if (!OPENAI_API_KEY) return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });

    const topic = String(req.body?.topic || "").trim();
    const content = String(req.body?.content || "").trim();
    const instruction = String(req.body?.instruction || "").trim();
    if (!topic || !content || !instruction) {
      return res.status(400).json({ ok: false, error: "Missing topic/content/instruction" });
    }

    const prompt = `
You are editing a draft blog post.
Topic: ${topic}

Instruction:
${instruction}

Return the FULL revised draft in clean markdown (no code fences).

Draft:
${content}
`.trim();

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        temperature: 0.4,
        max_output_tokens: 900,
      }),
    });

    const data = await r.json().catch(() => ({}));
    const text =
      (data.output_text ||
        data.output?.[0]?.content?.[0]?.text ||
        "").trim();

    if (!text) return res.status(500).json({ ok: false, error: "No content generated" });
    const cfg = loadConfig(ctx.shop);
    cfg.previewCache = cfg.previewCache || {};
    cfg.previewCache[topic] = text;
    saveConfig(cfg);
    return res.json({ ok: true, content: text });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// Preview: batch fetch/generate for topics
app.post("/admin/preview/batch", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cachedOnly = req.body?.cachedOnly === true;
    if (!OPENAI_API_KEY && !cachedOnly) {
      return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
    }

    const topics = Array.isArray(req.body?.topics) ? req.body.topics : [];
    const cleaned = topics.map(t => String(t || "").trim()).filter(Boolean).slice(0, 3);
    if (cleaned.length === 0) return res.json({ ok: true, previews: {} });

    const cfg = loadConfig(ctx.shop);
    cfg.previewCache = cfg.previewCache || {};
    const previews = {};

    for (const topic of cleaned) {
      if (cfg.previewCache[topic]) {
        previews[topic] = cfg.previewCache[topic];
        continue;
      }

      if (cachedOnly) {
        continue;
      }

      const prompt = `
Write a draft SEO blog post for this topic:
${topic}

Return clean markdown (no code fences). Include:
- Title
- Short intro
- 3-5 headings with short paragraphs
- A brief FAQ (3 Q/A)
Keep it helpful and not salesy.
`.trim();

      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          input: prompt,
          temperature: 0.4,
          max_output_tokens: 900,
        }),
      });

      const data = await r.json().catch(() => ({}));
      const text =
        (data.output_text ||
          data.output?.[0]?.content?.[0]?.text ||
          "").trim();

      if (text) {
        cfg.previewCache[topic] = text;
        previews[topic] = text;
      }
    }

    saveConfig(cfg);
    return res.json({ ok: true, previews });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// Product post: preview (manual-only)
app.post("/admin/product-post/preview", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    if (!OPENAI_API_KEY) return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
    const cfg = loadConfig(ctx.shop);
    const session = getShopifySession(cfg);
    if (!session) return res.status(400).json({ ok: false, error: "Shopify not connected" });

    const productId = String(req.body?.productId || "").trim();
    const angle = String(req.body?.angle || "").trim();
    if (!productId) return res.status(400).json({ ok: false, error: "Missing productId" });

    const products = await getProductCatalog(cfg, session);
    const product = products.find(p => p.id === productId);
    if (!product) return res.status(404).json({ ok: false, error: "Product not found" });
    const insights = await getShopifyInsightsForPrompt(cfg, session);

    const topic = angle ? `${product.title}: ${angle}` : product.title;
    const prompt = `
Write a draft SEO blog post focused on this product:
Product: ${product.title}
Type: ${product.productType || "—"}
Vendor: ${product.vendor || "—"}
Topic angle: ${angle || "General product education and use cases"}

Return clean markdown (no code fences). Include:
- Title
- Short intro
- 3-5 headings with short paragraphs
- A brief FAQ (3 Q/A)
Keep it helpful and not salesy.
Shopify insights (use for relevance, no PII): ${JSON.stringify(insights || cfg?.businessContext?.target_customer_facts || {})}
`.trim();

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        temperature: 0.4,
        max_output_tokens: 900,
      }),
    });

    const data = await r.json().catch(() => ({}));
    const text =
      (data.output_text ||
        data.output?.[0]?.content?.[0]?.text ||
        "").trim();
    if (!text) return res.status(500).json({ ok: false, error: "No content generated" });

    const appended = `${text}${buildProductLinkMarkdown(topic, [product])}`;
    cfg.previewCache = cfg.previewCache || {};
    cfg.previewCache[`product:${productId}`] = appended;
    saveConfig(cfg);
    return res.json({ ok: true, content: appended });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

// Product post: publish (manual-only)
app.post("/admin/product-post/publish", async (req, res) => {
  try {
    const ctx = getCfgFromReq(req, res);
    if (!ctx) return;
    const cfg = loadConfig(ctx.shop);
    const session = getShopifySession(cfg);
    if (!session) return res.status(400).json({ ok: false, error: "Shopify not connected" });
    if (!OPENAI_API_KEY) return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });

    const productId = String(req.body?.productId || "").trim();
    const angle = String(req.body?.angle || "").trim();
    const modeUsed = req.body?.mode === "draft" ? "draft" : "live";
    if (!productId) return res.status(400).json({ ok: false, error: "Missing productId" });

    const products = await getProductCatalog(cfg, session);
    const product = products.find(p => p.id === productId);
    if (!product) return res.status(404).json({ ok: false, error: "Product not found" });
    const insights = await getShopifyInsightsForPrompt(cfg, session);

    const topic = angle ? `${product.title}: ${angle}` : product.title;
    const prompt = `
You are writing for a US e-commerce brand: Monroe Mushroom Co.
Write an SEO blog post focused on this product:
Product: ${product.title}
Type: ${product.productType || "—"}
Vendor: ${product.vendor || "—"}
Topic angle: ${angle || "General product education and use cases"}

Return ONLY valid JSON with these keys:
- title (string)
- slug (string, lowercase, hyphenated, no special chars)
- meta_description (string, <= 155 chars)
- html (string, valid HTML with headings, bullets, short paragraphs)

Guidelines:
- Be helpful, not hypey. Avoid medical claims.
- Include a short FAQ section.
- Mention "Monroe Mushroom Co" naturally once.
- End with a short, natural call to action inviting readers to explore products on our website.
Shopify insights (use for relevance, no PII): ${JSON.stringify(insights || cfg?.businessContext?.target_customer_facts || {})}
`.trim();

    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
      }),
    });

    const openaiData = await openaiResp.json();
    const rawText =
      openaiData.output_text ||
      openaiData.output?.[0]?.content?.[0]?.text ||
      "";

    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    let post;
    try {
      post = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ ok: false, error: "OpenAI returned non-JSON", raw: cleaned.slice(0, 500) });
    }

    const relatedHtml = buildProductLinkHtml(topic, [product]);
    if (relatedHtml) {
      post.html = `${post.html}\n${relatedHtml}`;
    }

    const blogId = await resolveBlogId(cfg, session);
    if (!blogId) return res.status(500).json({ ok: false, error: "Missing blog ID" });

    const shopifyUrl = `https://${session.shopDomain}/admin/api/2025-07/graphql.json`;
    const mutation = `
      mutation CreateArticle($article: ArticleCreateInput!) {
        articleCreate(article: $article) {
          article { id title handle isPublished }
          userErrors { code field message }
        }
      }
    `;

    const variables = {
      article: {
        blogId,
        title: post.title,
        body: post.html,
        author: { name: AUTHOR_NAME },
        isPublished: modeUsed === "live",
        tags: DEFAULT_TAGS,
      },
    };

    const r = await fetch(shopifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    const data = await r.json().catch(() => null);
    const errs = data?.data?.articleCreate?.userErrors || [];
    const created = data?.data?.articleCreate?.article;

    if (!r.ok || errs.length > 0 || !created?.id) {
      return res.status(500).json({
        ok: false,
        error: errs.length ? errs.map(e => e.message).join(" | ") : "Product post failed",
        shopify: data,
      });
    }

    logActivity(ctx.shop, {
      type: "post",
      source: "manual",
      mode: modeUsed,
      title: created.title || "Untitled",
      published: !!created.isPublished,
    });

    return res.json({
      ok: true,
      title: created.title,
      articleId: created.id,
      isPublished: !!created.isPublished,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e || "Unknown error") });
  }
});

async function createSeoPost(shopDomain, topicOverride, modeOverride) {
  const cfg = loadConfig(shopDomain);
  const session = getShopifySession(cfg);
  if (!session) throw new Error("Shopify not connected");
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY env var");

  if (!isBillingActive(cfg)) {
    return {
      skipped: true,
      reason: "Billing required"
    };
  }

// --- v0.3 posting gate: refuse before setup (must use fresh config) ---
if (cfg._postingBlocked === true) {
  return {
    skipped: true,
    reason: "Business setup incomplete"
  };
}

  const topicItem =
    topicOverride ||
    (cfg.topicStrategy === "queue" && cfg.topics.length > 0
      ? cfg.topics[0]
      : null);
  const topicTitle = getTopicTitle(topicItem);
  const topicIntent = getTopicIntent(topicItem, cfg);

  // If no topics, we skip (your preference)
  if (!topicTitle) {
    return { skipped: true, reason: "No topics available" };
  }

  const matched = isExcludedTopic(cfg, topicTitle);
  if (matched) {
    return {
      skipped: true,
      reason: `Excluded topic match: "${matched}"`
    };
  }

  let relatedProducts = [];
  try {
    const products = await getProductCatalog(cfg, session);
    relatedProducts = selectRelatedProducts(topicTitle, products, 2);
  } catch {}
  const insights = await getShopifyInsightsForPrompt(cfg, session);

  // --- 1) Ask OpenAI to write the post (JSON output) ---
  const prompt = `
You are writing for a US e-commerce brand: Monroe Mushroom Co.
Write an SEO blog post about: ${topicTitle}
Intent: ${topicIntent} (informational = educate, commercial = compare/consider, transactional = purchase-focused).
Shopify insights (use for relevance, no PII): ${JSON.stringify(insights || cfg?.businessContext?.target_customer_facts || {})}

Return ONLY valid JSON with these keys:
- title (string)
- slug (string, lowercase, hyphenated, no special chars)
- meta_description (string, <= 155 chars)
- html (string, valid HTML with headings, bullets, short paragraphs)

Guidelines:
- Be helpful, not hypey. Avoid medical claims.
- Include a short FAQ section.
- Mention "Monroe Mushroom Co" naturally once.
- End with a short, natural call to action inviting readers to explore products from Monroe Mushroom Co on our website.
- Keep the CTA friendly, informative, and non-pushy.
`;

  const openaiResp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: prompt,
    }),
  });

  const openaiData = await openaiResp.json();
  const rawText =
    openaiData.output_text ||
    openaiData.output?.[0]?.content?.[0]?.text ||
    "";

  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  let post;
  try {
    post = JSON.parse(cleaned);
  } catch {
    return { skipped: true, reason: "OpenAI returned non-JSON", raw: cleaned.slice(0, 500) };
  }

  const relatedHtml = buildProductLinkHtml(topicTitle, relatedProducts);
  if (relatedHtml) {
    post.html = `${post.html}\n${relatedHtml}`;
  }

    // --- 2) Create article in Shopify ---
  const blogId = await resolveBlogId(cfg, session);
  if (!blogId) throw new Error("Missing blog ID");

  const shopifyUrl = `https://${session.shopDomain}/admin/api/2025-07/graphql.json`;
  const mutation = `
    mutation CreateArticle($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id title handle isPublished }
        userErrors { code field message }
      }
    }
  `;

  const modeUsed = (modeOverride === "draft" || modeOverride === "live") ? modeOverride : (cfg.mode === "draft" ? "draft" : "live");
  const isLive = modeUsed === "live";

  const variables = {
    article: {
      blogId,
      title: post.title,
      body: post.html,
      author: { name: AUTHOR_NAME },
      isPublished: isLive,
      tags: DEFAULT_TAGS,
    },
  };

  const r = await fetch(shopifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
"X-Shopify-Access-Token": session.accessToken,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const data = await r.json();

    // Advance queue + archive only if Shopify created the article
  const created = data?.data?.articleCreate?.article;

    if (created && cfg.topicStrategy === "queue") {
      const usedTopic = cfg.topics.shift();
      const normalizedUsed = normalizeTopicItem(usedTopic, cfg);

    if (normalizedUsed) {
      cfg.topicArchive = cfg.topicArchive || [];
      cfg.topicArchive.push({
        topic: normalizedUsed.title,
        intent: normalizedUsed.intent,
        postedAt: new Date().toISOString(),
        articleId: created.id
      });
    }

      cfg.lastRun = new Date().toISOString();
      saveConfig(cfg);
    }

    if (created) {
      maybeAutoGenerateTopics(shopDomain, cfg).catch(() => {});
    }

  return { skipped: false, topic: topicTitle, intent: topicIntent, post, shopify: data, mode: modeUsed };

}

app.get("/post-seo", async (req, res) => {
  try {
    const shop = getShopFromReq(req);
    if (!shop) {
      return res.status(401).json({ ok: false, error: "not_authenticated" });
    }
    // Daily limit gate (manual)
    const cfgGate = loadConfig(shop);
    const changed = initDailyUsage(cfgGate);
    if (changed) saveConfig(cfgGate);

const lim = cfgGate.dailyLimit || { enabled: true, maxPerDay: 6 };
const bypassLimit = !!cfgGate.devMode?.bypassDailyLimit || !!lim.devBypass;

if (lim.enabled && !bypassLimit) {
      const count = Number(cfgGate.dailyUsage?.count ?? 0);
      const max = Number(lim.maxPerDay ?? 6);
      if (count >= max) {
        return res.json({ skipped: true, reason: `Daily limit reached (${count}/${max})` });
      }
    }
    const manualMode = cfgGate?.schedules?.[0]?.mode === "draft" ? "draft" : "live";
    const result = await createSeoPost(shop, req.query.topic, manualMode);

    if (result.skipped) return res.json(result);

    // Keep response readable
    const created = result.shopify?.data?.articleCreate?.article;

    if (created?.id) {
      // increment daily usage (manual)
      const cfgInc = loadConfig(shop);
      const changed2 = initDailyUsage(cfgInc);
      if (changed2) {
        // if day changed, save the reset first
        saveConfig(cfgInc);
      }

      cfgInc.dailyUsage.count = Number(cfgInc.dailyUsage.count ?? 0) + 1;
      saveConfig(cfgInc);
      const intent = normalizeContentIntent(result.intent || classifyContentIntent(result.topic, cfgInc.businessContext));

      logActivity(shop, {
        type: "post",
        source: "manual",
        mode: manualMode,
        intent,
        title: created.title || "Untitled",
        published: !!created.isPublished,
      });
    } else {
      const errs = result.shopify?.data?.articleCreate?.userErrors || [];
      logActivity(shop, {
        type: "error",
        source: "manual",
        mode: manualMode,
        title: errs.length ? errs.map(e => e.message).join(" | ") : "Unknown error",
      });
    }

    return res.json({
      ok: true,
      topic: result.topic,
      title: result.post?.title,
      articleId: created?.id,
      isPublished: created?.isPublished,
      userErrors: result.shopify?.data?.articleCreate?.userErrors || []
    });
  } catch (e) {
    console.log("POST-SEO ERROR:", e);
    res.status(500).send(String(e));
  }
});

function startScheduler() {
  setInterval(async () => {
    try {
      const shops = listShops();
      const now = new Date();
      const todayKey = now.toDateString();
      for (const shop of shops) {
        const cfg = loadConfig(shop);
        const session = getShopifySession(cfg);
        if (!session) continue;
        const nowParts = getNowPartsInTimezone(cfg?.timezone);
        const currentTime = nowParts.timeHHMM;
        const todayKey = nowParts.dayKey;

        const currentStatus = schedulerStatusByShop.get(shop) || "ready";
        if (cfg.robotEnabled === false) {
          schedulerStatusByShop.set(shop, "paused");
          continue;
        } else if (currentStatus === "paused") {
          schedulerStatusByShop.set(shop, "ready");
        }

        if (cfg._postingBlocked === true) {
          continue;
        }

        if (cfg.topicGen?.enabled) {
          const minTopics = cfg.topicGen.minTopics ?? 3;
          if ((cfg.topics?.length ?? 0) <= minTopics) {
            console.log(`TopicGen (${shop}): low topics — generating more...`);
            const newTopics = await generateTopics(cfg);
            if (newTopics.length > 0) {
              cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
              cfg.topics.push(...newTopics);
              saveConfig(cfg);
              console.log(`TopicGen (${shop}): added ${newTopics.length} topics.`);
            } else {
              console.log(`TopicGen (${shop}): no topics generated (skipping).`);
            }
          }
        }

        if (lastPostDayByShop.get(shop) !== todayKey) {
          lastPostDayByShop.set(shop, todayKey);
          postedTimesByShop.set(shop, new Set());
        }

        const postedTimes = postedTimesByShop.get(shop) || new Set();
        const dueProfiles = getAllDueProfileIndexesNow(cfg, nowParts);

        if (dueProfiles.length > 0) {
          console.log(`Scheduler (${shop}): time hit — creating ${dueProfiles.length} post(s)...`);
          schedulerStatusByShop.set(shop, "posting");

          for (let di = 0; di < dueProfiles.length; di++) {
            const dueProfileIndex = dueProfiles[di];

            const postKey = `${todayKey}|${currentTime}|p${dueProfileIndex}`;
            if (postedTimes.has(postKey)) continue;
            postedTimes.add(postKey);
            postedTimesByShop.set(shop, postedTimes);

            const cfgGate = loadConfig(shop);
            const changed = initDailyUsage(cfgGate);
            if (changed) saveConfig(cfgGate);

            const scheduleMode = cfg?.schedules?.[dueProfileIndex]?.mode;
            const modeUsed = scheduleMode === "draft" ? "draft" : "live";

            const lim = cfgGate.dailyLimit || { enabled: true, maxPerDay: 6 };
            const bypassLimit = !!cfgGate.devMode?.bypassDailyLimit || !!lim.devBypass;

            if (lim.enabled && !bypassLimit) {
              const count = Number(cfgGate.dailyUsage?.count ?? 0);
              const max = Number(lim.maxPerDay ?? 6);

              if (count >= max) {
                logActivity(shop, {
                  type: "skip",
                  source: "scheduled",
                  profile: dueProfileIndex + 1,
                  mode: modeUsed,
                  title: "Daily post limit reached"
                });
                break;
              }
            }

            let result;
            try {
              result = await createSeoPost(shop, null, modeUsed);
            } catch (e) {
              logActivity(shop, {
                type: "error",
                source: "scheduled",
                profile: dueProfileIndex + 1,
                mode: modeUsed,
                title: `Scheduler error: ${String(e)}`,
              });
              continue;
            }

            if (result?.skipped) {
              logActivity(shop, {
                type: "skip",
                source: "scheduled",
                profile: dueProfileIndex + 1,
                mode: modeUsed,
                title: result.reason || "Skipped",
              });
              console.log(`Scheduler (${shop}): skipped (Profile ${dueProfileIndex + 1}):`, result.reason);
              continue;
            }

            const created = result?.shopify?.data?.articleCreate?.article;
            const errs = result?.shopify?.data?.articleCreate?.userErrors || [];

            if (created?.id) {
              const cfgInc = loadConfig(shop);
              const changed2 = initDailyUsage(cfgInc);
              if (changed2) saveConfig(cfgInc);

              cfgInc.dailyUsage.count = Number(cfgInc.dailyUsage.count ?? 0) + 1;
              saveConfig(cfgInc);

              logActivity(shop, {
                type: "post",
                source: "scheduled",
                profile: dueProfileIndex + 1,
                mode: modeUsed,
                intent: normalizeContentIntent(result.intent || classifyContentIntent(result.topic, cfgInc.businessContext)),
                title: created.title || "Untitled",
                published: !!created.isPublished,
              });

              console.log(
                `Scheduler (${shop}): created (Profile ${dueProfileIndex + 1}):`,
                created?.id,
                "published:",
                created?.isPublished
              );

              const cfgUpdate = loadConfig(shop);
              cfgUpdate.lastPost = {
                at: new Date().toISOString(),
                title: created?.title || "Untitled",
                published: created?.isPublished || false
              };
              saveConfig(cfgUpdate);
            } else {
              logActivity(shop, {
                type: "error",
                source: "scheduled",
                profile: dueProfileIndex + 1,
                mode: cfgGate.mode,
                title: errs.length ? errs.map(e => e.message).join(" | ") : "Unknown error",
              });
            }
          }

          schedulerStatusByShop.set(shop, "ready");
        }
      }
    } catch (e) {
      console.log("Scheduler error:", e);
    }
  }, 10 * 1000);
}

app.get("/__routes", (req, res) => {
  res.json({
    ok: true,
    hasStartupStatus: true,
  });
});

let PORT = Number(process.env.PORT || 3000);

async function isOurRobotOnPort(port) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);

    const res = await fetch(`http://localhost:${port}/__routes`, {
      signal: ctrl.signal,
      headers: { "Accept": "application/json" }
    });

    clearTimeout(t);

    if (!res.ok) return false;

    const data = await res.json();

    // This is our "fingerprint" endpoint
    return data && data.ok === true && data.hasStartupStatus === true;
  } catch {
    return false;
  }
}

function listenWithFallback() {
  const server = app.listen(PORT, () => {
  logSystem("global", { type: "robot_start" });
    console.log(`Robot running on http://localhost:${PORT}`);
    startScheduler();
  });

  server.on("error", (err) => {
   
  if (err && err.code === "EADDRINUSE") {
  (async () => {
    const isOurs = await isOurRobotOnPort(PORT);

    if (isOurs) {
      console.log(
        `Port ${PORT} is busy because AutoBlogger is already running. Refusing to start a duplicate.`
      );
      process.exit(1);
    }

    console.log(`Port ${PORT} is busy (not AutoBlogger). Trying next port...`);
 
 PORT = PORT + 1;
listenWithFallback();

  })();

  return;
}

    console.log("Startup failed:", err);
    process.exit(1);
  });
}

// Serve frontend in production
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "..", "dist");
  try {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } catch {}
}

const lock = acquireLock();
if (!lock.ok) {
  console.log("Refusing to start: another AutoBlogger instance is already running.");
  process.exit(1);
}

listenWithFallback();

process.on("SIGINT", () => {
  logSystem("global", { type: "robot_stop", reason: "SIGINT" });
  process.exit(0);
});








