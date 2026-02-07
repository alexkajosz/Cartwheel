 import { 
   LayoutDashboard, 
   Calendar, 
   FileText, 
  Activity, 
  Settings, 
  Store
} from 'lucide-react';
 import { cn } from '@/lib/utils';
 import { useAppStore } from '@/stores/appStore';
 
 interface NavItem {
   id: string;
   label: string;
   icon: React.ElementType;
 }
 
 const navItems: NavItem[] = [
   { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
   { id: 'scheduler', label: 'Scheduler', icon: Calendar },
   { id: 'topics', label: 'Topics', icon: FileText },
   { id: 'activity', label: 'Activity', icon: Activity },
 ];
 
 interface AppSidebarProps {
   activeView: string;
   onViewChange: (view: string) => void;
   onOpenSettings: () => void;
 }
 
export function AppSidebar({ activeView, onViewChange, onOpenSettings }: AppSidebarProps) {
  const { schedulerStatus, shopifyConnected, activityLog } = useAppStore();
  const lastOutcome = activityLog.find((log) => log.type === 'posted' || log.type === 'error');
  const lastTs = lastOutcome?.timestamp ? new Date(lastOutcome.timestamp).getTime() : 0;
  const ageMs = Date.now() - lastTs;
  const showSuccess = lastOutcome?.type === 'posted' && ageMs < 6000;
  const showFailed = lastOutcome?.type === 'error' && ageMs < 6000;
  const statusLabel =
    schedulerStatus === 'posting' ? 'Posting' :
    schedulerStatus === 'paused' ? 'Paused' :
    showFailed ? 'Failed' :
    showSuccess ? 'Success!' :
    'Ready';
  const statusColor =
    schedulerStatus === 'posting' ? 'bg-status-posting' :
    schedulerStatus === 'paused' ? 'bg-status-paused' :
    showFailed ? 'bg-status-failed' :
    showSuccess ? 'bg-status-success' :
    'bg-status-ready';
   
   return (
     <aside className="flex flex-col w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
       {/* Logo */}
        <div className="flex flex-col items-start gap-2 px-5 py-5 border-b border-sidebar-border">
          <div className="w-full rounded-lg bg-sidebar-accent/70 border border-sidebar-border/60 p-3 shadow-sm">
            <img
              src="/duro_logo.png"
              alt="duro"
              className="h-12 w-auto object-contain"
            />
          </div>
          <p className="text-2xs text-sidebar-muted">Content Engine</p>
        </div>
       
       {/* Status indicator */}
       <div className="px-4 py-3 border-b border-sidebar-border">
         <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-sidebar-accent">
          <div className={cn('w-2 h-2 rounded-full', statusColor)} />
          <span className="text-xs font-medium text-sidebar-accent-foreground">
            {statusLabel}
          </span>
         </div>
       </div>
       
       {/* Navigation */}
       <nav className="flex-1 px-3 py-4 space-y-1">
         {navItems.map((item) => (
           <button
             key={item.id}
             onClick={() => onViewChange(item.id)}
             className={cn(
               'flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
               activeView === item.id
                 ? 'bg-sidebar-accent text-sidebar-primary'
                 : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
             )}
           >
             <item.icon className="w-4 h-4" />
             {item.label}
           </button>
         ))}
       </nav>
       
       {/* Footer */}
       <div className="px-3 py-4 border-t border-sidebar-border space-y-2">
         {/* Shopify connection status */}
         <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-sidebar-accent/50">
           <Store className="w-4 h-4 text-sidebar-muted" />
           <span className="text-xs text-sidebar-foreground">
             {shopifyConnected ? 'Shopify Connected' : 'Not Connected'}
           </span>
            <div className={cn(
              'w-1.5 h-1.5 rounded-full ml-auto',
              shopifyConnected ? 'bg-status-ready' : 'bg-status-failed'
            )} />
         </div>
         
         {/* Settings button */}
         <button
           onClick={onOpenSettings}
           className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
         >
           <Settings className="w-4 h-4" />
           Settings
         </button>
       </div>
     </aside>
   );
 }

