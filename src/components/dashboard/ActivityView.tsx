 import { useState } from 'react';
 import { 
   CheckCircle2, 
   Clock, 
   XCircle, 
   AlertCircle, 
   Settings2,
   Filter,
   Trash2
 } from 'lucide-react';
 import { Button } from '@/components/ui/button';
 import { 
   Select, 
   SelectContent, 
   SelectItem, 
   SelectTrigger, 
   SelectValue 
 } from '@/components/ui/select';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
 import { format, subDays, startOfMonth, isAfter } from 'date-fns';
 import type { LogEntry, LogEntryType } from '@/types';
 
 type FilterPeriod = '7d' | '30d' | 'mtd' | 'all';
 
export function ActivityView() {
  const { activityLog, clearActivityLog, timeFormat } = useAppStore();
  const { toast } = useToast();
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('7d');
   const [filterType, setFilterType] = useState<LogEntryType | 'all'>('all');
   
   const getFilterDate = () => {
     const now = new Date();
     switch (filterPeriod) {
       case '7d': return subDays(now, 7);
       case '30d': return subDays(now, 30);
       case 'mtd': return startOfMonth(now);
       default: return new Date(0);
     }
   };
   
   const filteredLogs = activityLog.filter((log) => {
     const logDate = new Date(log.timestamp);
     const filterDate = getFilterDate();
     
     if (!isAfter(logDate, filterDate)) return false;
     if (filterType !== 'all' && log.type !== filterType) return false;
     
     return true;
   });
   
   const getLogIcon = (type: LogEntryType) => {
     switch (type) {
       case 'posted':
         return <CheckCircle2 className="w-4 h-4 text-success" />;
       case 'skipped':
         return <Clock className="w-4 h-4 text-warning" />;
       case 'error':
         return <XCircle className="w-4 h-4 text-destructive" />;
       case 'config_change':
         return <Settings2 className="w-4 h-4 text-brand" />;
       case 'validation_failure':
         return <AlertCircle className="w-4 h-4 text-destructive" />;
       default:
         return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
     }
   };
   
   const getLogTypeBadge = (type: LogEntryType) => {
     const styles: Record<LogEntryType, string> = {
       posted: 'bg-success/10 text-success',
       skipped: 'bg-warning/10 text-warning',
       error: 'bg-destructive/10 text-destructive',
       config_change: 'bg-brand/10 text-brand',
       validation_failure: 'bg-destructive/10 text-destructive',
     };
     
     return (
       <span className={`text-2xs font-medium px-2 py-0.5 rounded-full ${styles[type]}`}>
         {type.replace('_', ' ')}
       </span>
     );
   };
   
   return (
     <div className="space-y-6 animate-fade-in">
       {/* Filters */}
       <div className="panel">
         <div className="panel-body">
           <div className="flex flex-wrap items-center justify-between gap-4">
             <div className="flex items-center gap-3">
               <Filter className="w-4 h-4 text-muted-foreground" />
               <Select value={filterPeriod} onValueChange={(v) => setFilterPeriod(v as FilterPeriod)}>
                 <SelectTrigger className="w-32">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="7d">Last 7 days</SelectItem>
                   <SelectItem value="30d">Last 30 days</SelectItem>
                   <SelectItem value="mtd">Month to date</SelectItem>
                   <SelectItem value="all">All time</SelectItem>
                 </SelectContent>
               </Select>
               
               <Select value={filterType} onValueChange={(v) => setFilterType(v as LogEntryType | 'all')}>
                 <SelectTrigger className="w-40">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">All types</SelectItem>
                   <SelectItem value="posted">Posted</SelectItem>
                   <SelectItem value="skipped">Skipped</SelectItem>
                   <SelectItem value="error">Error</SelectItem>
                   <SelectItem value="config_change">Config change</SelectItem>
                   <SelectItem value="validation_failure">Validation failure</SelectItem>
                 </SelectContent>
               </Select>
             </div>
             
             <div className="flex items-center gap-2">
               <span className="text-sm text-muted-foreground">
                 {filteredLogs.length} entries
               </span>
                {activityLog.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await api.clearActivity();
                        clearActivityLog();
                        toast({
                          title: "Activity cleared",
                          description: "All activity entries were removed.",
                        });
                      } catch (e) {
                        toast({
                          title: "Clear failed",
                          description: String(e),
                          variant: "destructive",
                        });
                      }
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                   <Trash2 className="w-4 h-4 mr-1" />
                   Clear All
                 </Button>
               )}
             </div>
           </div>
         </div>
       </div>
       
       {/* Log List */}
       {filteredLogs.length > 0 ? (
         <div className="panel">
           <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
             <div className="divide-y divide-border">
               {filteredLogs.map((log) => (
                 <div key={log.id} className="flex items-start gap-4 px-5 py-4">
                   <div className="mt-0.5">
                     {getLogIcon(log.type)}
                   </div>
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2 mb-1">
                       <p className="text-sm font-medium">{log.message}</p>
                       {getLogTypeBadge(log.type)}
                     </div>
                     {log.details && (
                       <p className="text-xs text-muted-foreground mt-1">
                         {log.details}
                       </p>
                     )}
                   </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.timestamp), timeFormat === '24' ? 'MMM d, HH:mm' : 'MMM d, h:mm a')}
                    </span>
                 </div>
               ))}
             </div>
           </div>
         </div>
       ) : (
         <div className="panel">
           <div className="panel-body text-center py-12">
             <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
             <p className="text-muted-foreground">No activity found</p>
             <p className="text-sm text-muted-foreground mt-1">
               {filterType !== 'all' || filterPeriod !== 'all'
                 ? 'Try adjusting your filters'
                 : 'Activity will appear here once the scheduler runs'}
             </p>
           </div>
         </div>
       )}
     </div>
   );
 }
