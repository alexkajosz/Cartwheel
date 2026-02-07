import { useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { SetupWizard } from '@/components/wizard/SetupWizard';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import type { ContentGoal, LogEntry, SchedulerProfile, Topic } from '@/types';

const Index = () => {
  const {
    setupComplete,
    hydrateFromServer,
    setSchedulerStatus,
    setActivityLog,
    setShopifyConnected,
    setBilling,
    setDevMode,
    setSchedulerProfiles,
    setDailyPostLimit,
    setPostsToday,
    setContentIntentDefault,
    setTimezone,
    setTopicQueue,
    setTopicArchive,
    setIncludeProductPosts,
    devMode,
    shopifyConnected,
    resetAllLocal,
  } = useAppStore();

  useEffect(() => {
    let cancelled = false;

    const toTime = (s: string) => {
      const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      return { hour: Number(m[1]), minute: Number(m[2]) };
    };

    const daysMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const load = async () => {
      try {
        const cfgRes = await api.getConfig();
        const config = cfgRes.config || {};

        const bc = config.businessContext || {};
        const goals = bc.goals || {};

        const contentGoals: ContentGoal[] = [];
        if (goals.traffic) contentGoals.push('traffic');
        if (goals.sales) contentGoals.push('sales');
        if (goals.authority) contentGoals.push('authority');

        const businessConfig = {
          businessName: String(bc.business_name || ''),
          industry: String(bc.industry || ''),
          products: String(bc.products || bc.products_raw || ''),
          excludedTopics: Array.isArray(config.excludedTopics) ? config.excludedTopics : [],
          targetCustomer: String(bc.target_customer || ''),
          contentGoals,
          tone: (bc.tone || 'professional'),
        };
        const contentIntentDefault = String(config.contentIntentDefault || bc.content_intent_default || 'informational');
        const timezone = String(config.timezone || '');

        const schedules = Array.isArray(config.schedules)
          ? config.schedules
          : (config.schedule ? [config.schedule] : []);

        const schedulerProfiles: SchedulerProfile[] = schedules.map((p: any, i: number) => {
          const timesRaw = Array.isArray(p.times)
            ? p.times
            : String(p.time || "").split(",").map((t: string) => t.trim()).filter(Boolean);
          const times = timesRaw.map(toTime).filter(Boolean) as { hour: number; minute: number }[];
          return {
            id: `profile-${i + 1}`,
            name: `Schedule ${i + 1}`,
            enabled: p.enabled !== false,
            days: (Array.isArray(p.daysOfWeek) ? p.daysOfWeek : [])
              .map((d: string) => daysMap[String(d).trim()])
              .filter((d: number) => Number.isInteger(d)),
            times: times.length ? times : [{ hour: 9, minute: 0 }],
            mode: (p.mode === 'draft' ? 'draft' : (config.mode === 'draft' ? 'draft' : 'live')),
          };
        });

        const topics = Array.isArray(config.topics) ? config.topics : [];
        const topicQueue: Topic[] = topics.map((t: any, i: number) => ({
          id: `topic-${i}`,
          title: String(t?.title ?? t ?? ''),
          intent: (t?.intent || 'informational') as any,
          createdAt: new Date(),
        }));

        const archive = Array.isArray(config.topicArchive) ? config.topicArchive : [];
        const topicArchive: Topic[] = archive.map((t: any, i: number) => ({
          id: String(t.articleId || `archive-${i}`),
          title: String(t.topic || ''),
          intent: 'informational',
          createdAt: new Date(t.postedAt || Date.now()),
          usedAt: t.postedAt ? new Date(t.postedAt) : undefined,
        }));

        const dailyLimit = Number(config.dailyLimit?.maxPerDay ?? 3);
        const postsToday = Number(config.dailyUsage?.count ?? 0);

        const setupCompleteNext = bc.status === 'initialized';

        const hasName = !!String(bc.business_name || '').trim();
        const hasIndustry = !!String(bc.industry || '').trim();
        const hasProducts = !!String(bc.products || bc.products_raw || '').trim();
        const hasTarget = !!String(bc.target_customer || '').trim();
        const hasGoals = !!(goals.traffic || goals.sales || goals.authority);
        const hasIntent = !!String(config.contentIntentDefault || bc.content_intent_default || '').trim();
        const hasTone = !!String(bc.tone || '').trim();

        let wizardStep = 0;
        if (setupCompleteNext) {
          if (!cfgRes.shopifyConnected) {
            wizardStep = 0;
          } else if (!hasName && !hasIndustry && !hasProducts) {
            wizardStep = 1; // autofill choice
          } else if (!hasName) {
            wizardStep = 3;
          } else if (!hasIndustry) {
            wizardStep = 4;
          } else if (!hasProducts) {
            wizardStep = 5;
          } else if (!hasTarget) {
            wizardStep = 7;
          } else if (!hasGoals) {
            wizardStep = 8;
          } else if (!hasIntent) {
            wizardStep = 9;
          } else if (!hasTone) {
            wizardStep = 10;
          } else {
            wizardStep = 11;
          }
        } else {
          // Always return to Connect Shopify on refresh mid-setup
          wizardStep = 0;
        }

        if (!cancelled) {
          hydrateFromServer({
            setupComplete: setupCompleteNext,
            wizardStep,
            shopifyConnected: cfgRes.shopifyConnected,
            businessConfig,
            contentIntentDefault,
            timezone,
            schedulerProfiles,
            dailyPostLimit: dailyLimit,
            postsToday,
            topicQueue,
            topicArchive,
            topicAutoGenerate: config.topicGen?.enabled !== false,
            topicBatchSize: Number(config.topicGen?.batchSize ?? 5),
            minimumTopicThreshold: Number(config.topicGen?.minTopics ?? 3),
            includeProductPosts: !!config.topicGen?.includeProductPosts,
            devMode: {
              bypassBilling: !!config.devMode?.bypassBilling,
              bypassDailyLimit: !!config.devMode?.bypassDailyLimit,
              bypassSetupWizard: !!config.devMode?.bypassSetupWizard,
            },
          });
        }

        const statusRes = await api.getSchedulerStatus();
        if (!cancelled) {
          const rawStatus = String((statusRes as any)?.schedulerStatus || 'ready');
          const mappedStatus = rawStatus === 'idle' ? 'ready' : rawStatus;
          setSchedulerStatus(mappedStatus as any);
        }

        const activityRes = await api.getActivity();
        if (!cancelled && Array.isArray(activityRes.activity)) {
          const logs: LogEntry[] = activityRes.activity.slice(0, 200).map((a: any, i: number) => {
            const type =
              a.type === 'post' ? 'posted' :
              a.type === 'skip' ? 'skipped' :
              a.type === 'error' ? 'error' :
              'config_change';
            const detailsParts = [];
            if (a.source) detailsParts.push(String(a.source));
            if (a.mode) detailsParts.push(String(a.mode));
            if (a.profile) detailsParts.push(`profile ${a.profile}`);
            return {
              id: `${a.ts || Date.now()}-${i}`,
              type,
              message: String(a.title || a.type || 'Activity'),
              details: detailsParts.length ? detailsParts.join(' • ') : undefined,
              timestamp: new Date(a.ts || Date.now()),
            };
          });
          setActivityLog(logs);
        }

        // Double-check Shopify connection status
        const ctx = await api.getShopifyContext();
        if (!cancelled) {
          setShopifyConnected(!!ctx.connected, ctx.context || null);
        }

        const billing = await api.getBillingStatus().catch(() => null);
        if (!cancelled && billing) {
          setBilling({
            required: !!billing.required,
            status: (billing.status as any) || 'inactive',
            trialEndsAt: billing.trialEndsAt || null,
            confirmationUrl: billing.confirmationUrl || null,
            devBypass: !!billing.devBypass,
          });
        }
      } catch {
        if (!cancelled) {
          resetAllLocal();
          setShopifyConnected(false, null);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [hydrateFromServer, setActivityLog, setSchedulerStatus, setShopifyConnected]);

  useEffect(() => {
    if (!shopifyConnected) return;
    let cancelled = false;

    const syncAll = async () => {
      try {
        const cfgRes = await api.getConfig();
        if (cancelled) return;
        const config = cfgRes.config || {};
        const dailyLimit = Number(config.dailyLimit?.maxPerDay ?? 3);
        const postsToday = Number(config.dailyUsage?.count ?? 0);
        const contentIntentDefault = String(config.contentIntentDefault || config.businessContext?.content_intent_default || 'informational');
        const timezone = String(config.timezone || '');

        const schedules = Array.isArray(config.schedules)
          ? config.schedules
          : (config.schedule ? [config.schedule] : []);

        const daysMap: Record<string, number> = {
          Sun: 0,
          Mon: 1,
          Tue: 2,
          Wed: 3,
          Thu: 4,
          Fri: 5,
          Sat: 6,
        };
        const toTime = (s: string) => {
          const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
          if (!m) return null;
          return { hour: Number(m[1]), minute: Number(m[2]) };
        };
        const schedulerProfiles: SchedulerProfile[] = schedules.map((p: any, i: number) => {
          const timesRaw = Array.isArray(p.times)
            ? p.times
            : String(p.time || "").split(",").map((t: string) => t.trim()).filter(Boolean);
          const times = timesRaw.map(toTime).filter(Boolean) as { hour: number; minute: number }[];
          return {
            id: `profile-${i + 1}`,
            name: `Schedule ${i + 1}`,
            enabled: p.enabled !== false,
            days: (Array.isArray(p.daysOfWeek) ? p.daysOfWeek : [])
              .map((d: string) => daysMap[String(d).trim()])
              .filter((d: number) => Number.isInteger(d)),
            times: times.length ? times : [{ hour: 9, minute: 0 }],
            mode: (p.mode === 'draft' ? 'draft' : (config.mode === 'draft' ? 'draft' : 'live')),
          };
        });

        const topics = Array.isArray(config.topics) ? config.topics : [];
        const topicQueue: Topic[] = topics.map((t: any, i: number) => ({
          id: `topic-${i}`,
          title: String(t?.title ?? t ?? ''),
          intent: (t?.intent || 'informational') as any,
          createdAt: new Date(),
        }));
        const archive = Array.isArray(config.topicArchive) ? config.topicArchive : [];
        const topicArchive: Topic[] = archive.map((t: any, i: number) => ({
          id: String(t.articleId || `archive-${i}`),
          title: String(t.topic || t.title || ''),
          intent: (t.intent || 'informational') as any,
          createdAt: new Date(t.postedAt || Date.now()),
          usedAt: t.postedAt ? new Date(t.postedAt) : undefined,
        }));

        setTopicQueue(topicQueue);
        setTopicArchive(topicArchive);
        setSchedulerProfiles(schedulerProfiles);
        setDailyPostLimit(dailyLimit);
        setPostsToday(postsToday);
        setContentIntentDefault(contentIntentDefault);
        setTimezone(timezone);
        setIncludeProductPosts(!!config.topicGen?.includeProductPosts);
      } catch {
        // best-effort
      }

      try {
        const statusRes = await api.getSchedulerStatus();
        if (cancelled) return;
        const rawStatus = String((statusRes as any)?.schedulerStatus || 'ready');
        const mappedStatus = rawStatus === 'idle' ? 'ready' : rawStatus;
        setSchedulerStatus(mappedStatus as any);
      } catch {
        // best-effort
      }

      try {
        const activityRes = await api.getActivity();
        if (cancelled) return;
        if (Array.isArray(activityRes.activity)) {
          const logs: LogEntry[] = activityRes.activity.slice(0, 200).map((a: any, i: number) => {
            const type =
              a.type === 'post' ? 'posted' :
              a.type === 'skip' ? 'skipped' :
              a.type === 'error' ? 'error' :
              'config_change';
            const detailsParts = [];
            if (a.source) detailsParts.push(String(a.source));
            if (a.mode) detailsParts.push(String(a.mode));
            if (a.profile) detailsParts.push(`profile ${a.profile}`);
            return {
              id: `${a.ts || Date.now()}-${i}`,
              type,
              message: String(a.title || a.type || 'Activity'),
              details: detailsParts.length ? detailsParts.join(' • ') : undefined,
              timestamp: new Date(a.ts || Date.now()),
            };
          });
          setActivityLog(logs);
        }
      } catch {
        // best-effort
      }
    };

    syncAll();
    const interval = setInterval(syncAll, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    shopifyConnected,
    setTopicQueue,
    setTopicArchive,
    setActivityLog,
    setSchedulerStatus,
    setDailyPostLimit,
    setPostsToday,
    setSchedulerProfiles,
    setContentIntentDefault,
    setTimezone,
    setIncludeProductPosts
  ]);

  useEffect(() => {
    if (!shopifyConnected) return;
    let cancelled = false;

    const detectTimezone = () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch {
        return '';
      }
    };

    let currentTz = detectTimezone();
    if (currentTz) {
      setTimezone(currentTz);
      api.setTimezone(currentTz).catch(() => {});
    }

    const interval = setInterval(() => {
      if (cancelled) return;
      const nextTz = detectTimezone();
      if (nextTz && nextTz !== currentTz) {
        currentTz = nextTz;
        setTimezone(nextTz);
        api.setTimezone(nextTz).catch(() => {});
      }
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [shopifyConnected, setTimezone]);
  
  return (
    <>
      <MainLayout />
      <SetupWizard open={!setupComplete && !devMode.bypassSetupWizard} />
    </>
  );
};

export default Index;
