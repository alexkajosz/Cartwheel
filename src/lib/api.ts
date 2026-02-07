type ApiOk<T extends object = object> = { ok: true } & T;
type ApiErr = { ok: false; error?: string };

async function apiFetch<T extends object>(
  path: string,
  options: RequestInit = {}
): Promise<ApiOk<T>> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data: ApiOk<T> | ApiErr;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: text };
  }

  if (!res.ok || !data.ok) {
    const err = (data as ApiErr).error || res.statusText || "Request failed";
    throw new Error(err);
  }

  return data as ApiOk<T>;
}

export const api = {
  getConfig: () => apiFetch<{ config: any; shopifyConnected: boolean }>("/admin/config"),
  getShopifyContext: () => apiFetch<{ connected: boolean; context: any }>("/admin/shopify/context"),
  getShopifyInsights: () => apiFetch<{ connected: boolean; insights: any }>("/admin/shopify/insights"),
  getShopifyProducts: () => apiFetch<{ connected: boolean; products: any[] }>("/admin/shopify/products"),
  disconnectShopify: () => apiFetch("/admin/shopify/disconnect", { method: "POST" }),

  setupAutopopulate: () => apiFetch<{ config: any }>("/admin/setup/autopopulate", { method: "POST" }),
  setupStep1: (businessName: string) =>
    apiFetch<{ config: any }>("/admin/setup/step1", {
      method: "POST",
      body: JSON.stringify({ business_name: businessName }),
    }),
  setupStep2: (industry: string) =>
    apiFetch<{ config: any }>("/admin/setup/step2", {
      method: "POST",
      body: JSON.stringify({ industry }),
    }),
  setupStep3: (products: string, excludedTopics: string[]) =>
    apiFetch<{ config: any }>("/admin/setup/step3", {
      method: "POST",
      body: JSON.stringify({ products, excludedTopics }),
    }),
  setupStep4: (targetCustomer: string) =>
    apiFetch<{ config: any }>("/admin/setup/step4", {
      method: "POST",
      body: JSON.stringify({ target_customer: targetCustomer }),
    }),
  setupStep5: (goals: { traffic: boolean; sales: boolean; authority: boolean }) =>
    apiFetch<{ config: any }>("/admin/setup/step5", {
      method: "POST",
      body: JSON.stringify({ goals }),
    }),
  setupIntent: (intent: string) =>
    apiFetch<{ config: any }>("/admin/setup/intent", {
      method: "POST",
      body: JSON.stringify({ intent }),
    }),
  setupStep6: (tone: string) =>
    apiFetch<{ config: any }>("/admin/setup/step6", {
      method: "POST",
      body: JSON.stringify({ tone }),
    }),
  setupFinish: () => apiFetch<{ config: any }>("/admin/setup/finish", { method: "POST" }),
  setupRestart: () => apiFetch<{ config: any }>("/admin/setup/restart", { method: "POST" }),
  suggestTargetCustomer: () => apiFetch<{ target_customer: string }>("/admin/setup/suggest-target-customer", { method: "POST" }),
  cleanInput: (field: string, text: string, maxChars = 2000) =>
    apiFetch<{ valid: boolean; cleaned: string; reason?: string; ai?: boolean }>("/admin/ai/clean-input", {
      method: "POST",
      body: JSON.stringify({ field, text, maxChars }),
    }),

  getTopics: () => apiFetch<{ topics: string[]; archive: any[] }>("/admin/topics"),
  addTopic: (topic: string, intent?: string) =>
    apiFetch<{ topics: string[] }>("/admin/topics/add", {
      method: "POST",
      body: JSON.stringify({ topic, intent }),
    }),
  removeTopic: (index: number) =>
    apiFetch<{ topics: string[]; removed: string }>("/admin/topics/remove", {
      method: "POST",
      body: JSON.stringify({ index }),
    }),
  archiveTopic: (index: number, topic?: string) =>
    apiFetch<{ topics: string[]; archive: any[] }>("/admin/topics/archive", {
      method: "POST",
      body: JSON.stringify({ index, topic }),
    }),
  generateTopics: () => apiFetch<{ added: number; topicsCount: number }>("/admin/topics/generate", { method: "POST" }),
  clearTopicQueue: () => apiFetch("/admin/topics/clear-queue", { method: "POST" }),
  clearTopicArchive: () => apiFetch("/admin/topics/clear-archive", { method: "POST" }),
  releaseTopicArchive: () =>
    apiFetch<{ topics: string[]; archive: any[] }>("/admin/topics/release-archive", {
      method: "POST",
    }),
  previewGenerate: (topic: string) =>
    apiFetch<{ content: string }>("/admin/preview/generate", {
      method: "POST",
      body: JSON.stringify({ topic }),
    }),
  previewEdit: (topic: string, content: string, instruction: string) =>
    apiFetch<{ content: string }>("/admin/preview/edit", {
      method: "POST",
      body: JSON.stringify({ topic, content, instruction }),
    }),
  previewBatch: (topics: string[], cachedOnly = false) =>
    apiFetch<{ previews: Record<string, string> }>("/admin/preview/batch", {
      method: "POST",
      body: JSON.stringify({ topics, cachedOnly }),
    }),

  toggleTopicGen: () => apiFetch<{ enabled: boolean; topicGen: any }>("/admin/topicgen/toggle", { method: "POST" }),
  updateTopicGen: (minTopics: number, batchSize: number, includeProductPosts?: boolean) =>
    apiFetch<{ topicGen: any }>("/admin/topicgen/update", {
      method: "POST",
      body: JSON.stringify({ minTopics, batchSize, includeProductPosts }),
    }),

  setMode: (mode: 'live' | 'draft') =>
    apiFetch<{ mode: string }>("/admin/mode", {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),

  updateSchedule: (profiles: { enabled: boolean; daysOfWeek: string[]; times: string[] }[]) =>
    apiFetch<{ schedules: any[] }>("/admin/update-schedule", {
      method: "POST",
      body: JSON.stringify({ profiles }),
    }),

  getSchedulerStatus: () => apiFetch<{ schedulerStatus: string }>("/admin/scheduler-status"),
  getActivity: () => apiFetch<{ activity: any[] }>("/admin/activity"),
  getBillingStatus: () => apiFetch<{ status: string; trialEndsAt: string | null; active: boolean; required: boolean; confirmationUrl?: string | null; devBypass?: boolean }>("/admin/billing/status"),
  startBilling: () => apiFetch<{ confirmationUrl: string }>("/admin/billing/start", { method: "POST" }),
  setDevMode: (mode: { bypassBilling: boolean; bypassDailyLimit: boolean }) =>
    apiFetch<{ devMode: any }>("/admin/dev-mode", {
      method: "POST",
      body: JSON.stringify(mode),
    }),
  setTimezone: (timezone: string) =>
    apiFetch<{ timezone: string }>("/admin/timezone", {
      method: "POST",
      body: JSON.stringify({ timezone }),
    }),

  toggleRobot: () => apiFetch<{ robotEnabled: boolean }>("/admin/toggle-robot", { method: "POST" }),
  toggleMode: () => apiFetch<{ mode: string }>("/admin/toggle-mode", { method: "POST" }),
  updateDailyLimit: (maxPerDay: number) =>
    apiFetch<{ dailyLimit: any }>("/admin/daily-limit", {
      method: "POST",
      body: JSON.stringify({ maxPerDay }),
    }),
  resetAll: () => apiFetch<{ config: any }>("/admin/reset-all", { method: "POST" }),

  testPost: (publish = false) =>
    apiFetch<{ title: string; articleId: string; isPublished: boolean }>("/admin/testpost", {
      method: "POST",
      body: JSON.stringify({ publish }),
    }),
  productPostPreview: (productId: string, angle?: string) =>
    apiFetch<{ content: string }>("/admin/product-post/preview", {
      method: "POST",
      body: JSON.stringify({ productId, angle }),
    }),
  productPostPublish: (productId: string, angle?: string, mode: 'live' | 'draft' = 'live') =>
    apiFetch<{ title: string; articleId: string; isPublished: boolean }>("/admin/product-post/publish", {
      method: "POST",
      body: JSON.stringify({ productId, angle, mode }),
    }),
  postSeo: async (topic?: string) => {
    const url = topic ? `/post-seo?topic=${encodeURIComponent(topic)}` : "/post-seo";
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      throw new Error(data?.error || res.statusText || "Post failed");
    }
    return data;
  },
};
