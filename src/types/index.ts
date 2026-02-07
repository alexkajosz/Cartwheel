 // duro Type Definitions
 
 export type SetupStatus = 'incomplete' | 'in_progress' | 'complete';
 
export type SchedulerStatus = 'posting' | 'ready' | 'paused';
 
 export type ContentIntent = 'informational' | 'commercial' | 'transactional';
 
 export type ContentGoal = 'traffic' | 'sales' | 'authority';
 
export type ToneStyle = 'professional' | 'friendly' | 'bold';

export type LogEntryType = 'posted' | 'skipped' | 'error' | 'config_change' | 'validation_failure';

export interface DevMode {
  bypassBilling: boolean;
  bypassDailyLimit: boolean;
}

 export interface ScheduleTime {
   hour: number;
   minute: number;
 }
 
export interface SchedulerProfile {
  id: string;
  name: string;
  enabled: boolean;
  days: number[]; // 0-6, Sunday = 0
  times: ScheduleTime[];
  mode?: 'live' | 'draft';
}
 
 export interface Topic {
   id: string;
   title: string;
   intent: ContentIntent;
   createdAt: Date;
   usedAt?: Date;
 }
 
 export interface LogEntry {
   id: string;
   type: LogEntryType;
   message: string;
   details?: string;
   timestamp: Date;
 }
 
 export interface BusinessConfig {
   businessName: string;
   industry: string;
   products: string;
   excludedTopics: string[];
   targetCustomer: string;
   contentGoals: ContentGoal[];
   tone: ToneStyle;
 }
 
 export interface AppConfig {
   setupComplete: boolean;
   shopifyConnected: boolean;
   business: BusinessConfig;
   schedulerProfiles: SchedulerProfile[];
   dailyPostLimit: number;
   topicAutoGenerate: boolean;
   topicBatchSize: number;
   minimumTopicThreshold: number;
 }
 
 export interface WizardStep {
   id: string;
   title: string;
   description: string;
 }

