import { useMemo, useState } from 'react';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { SchedulerView } from '@/components/dashboard/SchedulerView';
import { TopicsView } from '@/components/dashboard/TopicsView';
import { ActivityView } from '@/components/dashboard/ActivityView';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatDistanceToNowStrict } from 'date-fns';
 
 const viewConfig: Record<string, { title: string; subtitle?: string }> = {
   dashboard: { title: 'Dashboard', subtitle: 'Overview of your content engine' },
   scheduler: { title: 'Scheduler', subtitle: 'Manage posting schedules' },
   topics: { title: 'Topics', subtitle: 'Manage your content queue' },
   activity: { title: 'Activity Log', subtitle: 'View posting history and events' },
 };
 
export function MainLayout() {
  const [activeView, setActiveView] = useState('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { billing, devMode, shopifyConnected } = useAppStore();
  const trialCountdown = useMemo(() => {
    if (!billing.trialEndsAt) return null;
    const t = new Date(billing.trialEndsAt);
    if (Number.isNaN(t.getTime())) return null;
    return formatDistanceToNowStrict(t, { addSuffix: true });
  }, [billing.trialEndsAt]);
  const showBillingGate = shopifyConnected && billing.required && !billing.devBypass && !devMode.bypassBilling;
   
   const currentViewConfig = viewConfig[activeView] || viewConfig.dashboard;
   
   const renderView = () => {
     switch (activeView) {
       case 'scheduler':
         return <SchedulerView />;
       case 'topics':
         return <TopicsView />;
       case 'activity':
         return <ActivityView />;
       default:
         return <DashboardView onNavigate={setActiveView} />;
     }
   };
   
  return (
    <div className="flex h-screen bg-background">
       <AppSidebar 
         activeView={activeView} 
         onViewChange={setActiveView}
         onOpenSettings={() => setSettingsOpen(true)}
       />
       
       <div className="flex flex-col flex-1 overflow-hidden">
         <Header 
           title={currentViewConfig.title} 
           subtitle={currentViewConfig.subtitle} 
         />
         
         <main className="flex-1 overflow-auto p-8">
           {renderView()}
         </main>
       </div>
       
      <SettingsModal 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen} 
      />

      {showBillingGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-xl rounded-lg border-4 border-destructive bg-background p-6 shadow-industrial-lg">
            <p className="text-xs font-semibold uppercase text-destructive">Paywall (Dev Alert)</p>
            <h2 className="text-xl font-semibold mt-2">Start Your 24‑Hour Trial</h2>
            <p className="text-sm text-muted-foreground mt-2">
              This app is locked until billing is activated. Start the trial to continue.
            </p>
            {trialCountdown && (
              <p className="text-xs text-muted-foreground mt-2">
                Trial ends {trialCountdown}
              </p>
            )}
            <div className="mt-4 flex items-center gap-3">
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  try {
                    const res = await api.startBilling();
                    if (res.confirmationUrl) {
                      window.location.href = res.confirmationUrl;
                    }
                  } catch {
                    // ignore
                  }
                }}
              >
                Start Trial + Subscribe
              </Button>
              <Button
                variant="outline"
                onClick={() => setSettingsOpen(true)}
              >
                Open Settings
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
