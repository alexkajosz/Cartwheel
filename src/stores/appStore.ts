 import { create } from 'zustand';
 import { persist } from 'zustand/middleware';
 import type { 
   AppConfig, 
   SchedulerStatus, 
   Topic, 
   LogEntry, 
   SchedulerProfile,
   BusinessConfig,
   ContentGoal,
   ToneStyle,
   DevMode,
   ContentIntent
 } from '@/types';
 
interface AppState {
  // Setup state
  setupComplete: boolean;
  wizardStep: number;
  serverHydrated: boolean;
  autofillCompleted: boolean;
   
   // Shopify state
   shopifyConnected: boolean;
   shopifyData: {
     storeName?: string;
     products?: string[];
     collections?: string[];
   } | null;
   shopDomainInput: string;
   
  // Business config
  businessConfig: BusinessConfig;
  contentIntentDefault: ContentIntent;
   
  // Scheduler state
  schedulerStatus: SchedulerStatus;
  schedulerProfiles: SchedulerProfile[];
  dailyPostLimit: number;
  postsToday: number;
   
   // Topics state
   topicQueue: Topic[];
   topicArchive: Topic[];
  topicAutoGenerate: boolean;
  topicBatchSize: number;
  minimumTopicThreshold: number;
  includeProductPosts: boolean;
   
  // Activity log
  activityLog: LogEntry[];

  // Timezone
  timezone: string;

  // Billing / dev mode
  billing: {
    required: boolean;
    status: 'active' | 'trial' | 'inactive';
    trialEndsAt: string | null;
    confirmationUrl: string | null;
    devBypass: boolean;
  };
  devMode: DevMode;
   
  // Actions
  hydrateFromServer: (payload: Partial<AppState>) => void;
  setServerHydrated: (hydrated: boolean) => void;
  setWizardStep: (step: number) => void;
  setAutofillCompleted: (completed: boolean) => void;
  completeSetup: () => void;
  resetSetup: () => void;
  resetAllLocal: () => void;
  setSetupComplete: (complete: boolean) => void;
   
  connectShopify: (data: { storeName: string; products: string[]; collections: string[] }) => void;
  disconnectShopify: () => void;
  setShopifyConnected: (connected: boolean, data?: { storeName?: string; products?: string[]; collections?: string[] } | null) => void;
  setShopDomainInput: (value: string) => void;
   
  updateBusinessConfig: (config: Partial<BusinessConfig>) => void;
  setBusinessConfig: (config: BusinessConfig) => void;
  setContentIntentDefault: (intent: ContentIntent) => void;
   
  setSchedulerStatus: (status: SchedulerStatus) => void;
  setSchedulerProfiles: (profiles: SchedulerProfile[]) => void;
  addSchedulerProfile: (profile: SchedulerProfile) => void;
  updateSchedulerProfile: (id: string, updates: Partial<SchedulerProfile>) => void;
  removeSchedulerProfile: (id: string) => void;
  setDailyPostLimit: (limit: number) => void;
  setPostsToday: (count: number) => void;
   
  addTopic: (topic: Topic) => void;
  removeTopic: (id: string) => void;
  archiveTopic: (id: string) => void;
  setTopicAutoGenerate: (enabled: boolean) => void;
  setTopicQueue: (topics: Topic[]) => void;
  setTopicArchive: (topics: Topic[]) => void;
  setTopicBatchSize: (size: number) => void;
  setMinimumTopicThreshold: (count: number) => void;
  setIncludeProductPosts: (enabled: boolean) => void;
   
  addLogEntry: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearActivityLog: () => void;
  setActivityLog: (entries: LogEntry[]) => void;
  setBilling: (billing: AppState['billing']) => void;
  setDevMode: (mode: DevMode) => void;
  setTimezone: (timezone: string) => void;
}
 
 const defaultBusinessConfig: BusinessConfig = {
   businessName: '',
   industry: '',
   products: '',
   excludedTopics: [],
   targetCustomer: '',
   contentGoals: [],
   tone: 'professional',
 };
 
 const defaultSchedulerProfile: SchedulerProfile = {
   id: 'default',
   name: 'Default Schedule',
   enabled: true,
   days: [1, 2, 3, 4, 5], // Mon-Fri
   times: [{ hour: 9, minute: 0 }],
   mode: 'live',
 };
 
 export const useAppStore = create<AppState>()(
   persist(
     (set, get) => ({
       // Initial state
      setupComplete: false,
      wizardStep: 0,
      serverHydrated: false,
      autofillCompleted: false,
       
       shopifyConnected: false,
       shopifyData: null,
       shopDomainInput: '',
       
       businessConfig: defaultBusinessConfig,
       contentIntentDefault: 'informational',
       
      schedulerStatus: 'ready',
      schedulerProfiles: [defaultSchedulerProfile],
      dailyPostLimit: 3,
      postsToday: 0,
       
       topicQueue: [],
       topicArchive: [],
      topicAutoGenerate: true,
      topicBatchSize: 5,
      minimumTopicThreshold: 3,
      includeProductPosts: false,
    
  activityLog: [],
  timezone: '',

   billing: {
     required: false,
     status: 'inactive',
     trialEndsAt: null,
     confirmationUrl: null,
     devBypass: false,
   },
   devMode: {
     bypassBilling: false,
     bypassDailyLimit: false,
   },
      
      // Actions
      hydrateFromServer: (payload) => set({ ...payload, serverHydrated: true }),
      setServerHydrated: (hydrated) => set({ serverHydrated: hydrated }),
      setWizardStep: (step) => set({ wizardStep: step }),
      setAutofillCompleted: (completed) => set({ autofillCompleted: completed }),
      
      completeSetup: () => set({ setupComplete: true }),
      setSetupComplete: (complete) => set({ setupComplete: complete }),
      
      resetSetup: () => set({ 
        setupComplete: false, 
        wizardStep: 0,
        businessConfig: defaultBusinessConfig,
        shopDomainInput: '',
        contentIntentDefault: 'informational',
        autofillCompleted: false,
      }),

      resetAllLocal: () => set({
        setupComplete: false,
        wizardStep: 0,
        serverHydrated: false,
        shopifyConnected: false,
        shopifyData: null,
        shopDomainInput: '',
        autofillCompleted: false,
        businessConfig: defaultBusinessConfig,
        contentIntentDefault: 'informational',
        schedulerStatus: 'ready',
        schedulerProfiles: [defaultSchedulerProfile],
        dailyPostLimit: 3,
        postsToday: 0,
        topicQueue: [],
        topicArchive: [],
        topicAutoGenerate: true,
        topicBatchSize: 5,
        minimumTopicThreshold: 3,
        includeProductPosts: false,
        activityLog: [],
        timezone: '',
        billing: {
          required: false,
          status: 'inactive',
          trialEndsAt: null,
          confirmationUrl: null,
          devBypass: false,
        },
        devMode: {
          bypassBilling: false,
          bypassDailyLimit: false,
        },
      }),
       
      connectShopify: (data) => set({ 
        shopifyConnected: true, 
        shopifyData: data,
      }),
      
      disconnectShopify: () => set({ 
        shopifyConnected: false, 
        shopifyData: null,
      }),

      setShopifyConnected: (connected, data = null) => set({
        shopifyConnected: connected,
        shopifyData: connected ? (data || {}) : null,
      }),

      setShopDomainInput: (value) => set({ shopDomainInput: String(value || '') }),
      
      updateBusinessConfig: (config) => set((state) => ({
        businessConfig: { ...state.businessConfig, ...config },
      })),

      setBusinessConfig: (config) => set({ businessConfig: config }),
      setContentIntentDefault: (intent) => set({ contentIntentDefault: intent }),
      
      setSchedulerStatus: (status) => set({ schedulerStatus: status }),
      setSchedulerProfiles: (profiles) => set({ schedulerProfiles: profiles }),
      
      addSchedulerProfile: (profile) => set((state) => ({
        schedulerProfiles: [...state.schedulerProfiles, profile],
      })),
       
       updateSchedulerProfile: (id, updates) => set((state) => ({
         schedulerProfiles: state.schedulerProfiles.map((p) =>
           p.id === id ? { ...p, ...updates } : p
         ),
       })),
       
      removeSchedulerProfile: (id) => set((state) => ({
        schedulerProfiles: state.schedulerProfiles.filter((p) => p.id !== id),
      })),
      
      setDailyPostLimit: (limit) => set({ dailyPostLimit: limit }),
      setPostsToday: (count) => set({ postsToday: count }),
       
       addTopic: (topic) => set((state) => ({
         topicQueue: [...state.topicQueue, topic],
       })),
       
       removeTopic: (id) => set((state) => ({
         topicQueue: state.topicQueue.filter((t) => t.id !== id),
       })),
       
       archiveTopic: (id) => set((state) => {
         const topic = state.topicQueue.find((t) => t.id === id);
         if (!topic) return state;
         return {
           topicQueue: state.topicQueue.filter((t) => t.id !== id),
           topicArchive: [...state.topicArchive, { ...topic, usedAt: new Date() }],
         };
       }),
       
      setTopicAutoGenerate: (enabled) => set({ topicAutoGenerate: enabled }),
      setTopicQueue: (topics) => set({ topicQueue: topics }),
      setTopicArchive: (topics) => set({ topicArchive: topics }),
      setTopicBatchSize: (size) => set({ topicBatchSize: size }),
      setMinimumTopicThreshold: (count) => set({ minimumTopicThreshold: count }),
      setIncludeProductPosts: (enabled) => set({ includeProductPosts: !!enabled }),
       
      addLogEntry: (entry) => set((state) => ({
        activityLog: [
          {
            ...entry,
            id: crypto.randomUUID(),
            timestamp: new Date(),
           },
           ...state.activityLog,
         ].slice(0, 500), // Keep last 500 entries
       })),
       
      clearActivityLog: () => set({ activityLog: [] }),
    setActivityLog: (entries) => set({ activityLog: entries }),

    setBilling: (billing) => set({ billing }),
    setDevMode: (mode) => set({ devMode: mode }),
    setTimezone: (timezone) => set({ timezone: String(timezone || '') }),
   }),
   {
     name: 'duro-storage',
     partialize: (state) => ({
        setupComplete: state.setupComplete,
        shopifyConnected: state.shopifyConnected,
        shopifyData: state.shopifyData,
        shopDomainInput: state.shopDomainInput,
        autofillCompleted: state.autofillCompleted,
        businessConfig: state.businessConfig,
        contentIntentDefault: state.contentIntentDefault,
        schedulerProfiles: state.schedulerProfiles,
        dailyPostLimit: state.dailyPostLimit,
        topicQueue: state.topicQueue,
        topicArchive: state.topicArchive,
        topicAutoGenerate: state.topicAutoGenerate,
        topicBatchSize: state.topicBatchSize,
        minimumTopicThreshold: state.minimumTopicThreshold,
        includeProductPosts: state.includeProductPosts,
        activityLog: state.activityLog,
        devMode: state.devMode,
        timezone: state.timezone,
      }),
    }
  )
);

