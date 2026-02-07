import { useEffect, useState } from 'react';
import { Plus, Trash2, Clock, Calendar, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
 import { Label } from '@/components/ui/label';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import type { SchedulerProfile, ScheduleTime } from '@/types';
 
 const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
 
 export function SchedulerView() {
  const { 
    schedulerProfiles, 
    schedulerStatus,
    timeFormat,
    dailyPostLimit,
    postsToday,
    serverHydrated,
    activityLog,
    addSchedulerProfile,
    updateSchedulerProfile,
    removeSchedulerProfile,
    setSchedulerStatus,
  } = useAppStore();
   const { toast } = useToast();
   
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const lastOutcome = activityLog.find((log) => log.type === 'posted' || log.type === 'error');
  const lastTs = lastOutcome?.timestamp ? new Date(lastOutcome.timestamp).getTime() : 0;
  const ageMs = Date.now() - lastTs;
  const showFailed = lastOutcome?.type === 'error' && ageMs < 6000;
  const showSuccess = lastOutcome?.type === 'posted' && ageMs < 6000;
  const statusTone =
    schedulerStatus === 'posting' ? { label: 'Posting', className: 'bg-status-posting text-warning' } :
    schedulerStatus === 'paused' ? { label: 'Paused', className: 'bg-status-paused text-warning' } :
    showFailed ? { label: 'Failed', className: 'bg-status-failed text-destructive' } :
    showSuccess ? { label: 'Success!', className: 'bg-status-success text-success' } :
    { label: 'Ready', className: 'bg-status-ready text-success' };

  useEffect(() => {
    if (!serverHydrated) return;
    const t = setTimeout(() => {
      const profiles = schedulerProfiles.map((p) => ({
        enabled: p.enabled,
        daysOfWeek: p.days.map((d) => DAYS[d]),
        times: p.times.map((t) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`),
        mode: p.mode === 'draft' ? 'draft' : 'live',
      }));
      api.updateSchedule(profiles).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [schedulerProfiles, serverHydrated]);
   
   const handleAddProfile = () => {
     if (schedulerProfiles.length >= 7) {
       toast({
         title: "Profile limit reached",
         description: "You can have up to 7 scheduler profiles.",
         variant: "destructive",
       });
       return;
     }
     
     const newProfile: SchedulerProfile = {
       id: crypto.randomUUID(),
       name: `Schedule ${schedulerProfiles.length + 1}`,
       enabled: false,
       days: [1, 2, 3, 4, 5],
       times: [{ hour: 9, minute: 0 }],
       mode: 'live',
     };
     
     addSchedulerProfile(newProfile);
     setEditingProfile(newProfile.id);
   };
   
   const handleToggleDay = (profileId: string, dayIndex: number) => {
     const profile = schedulerProfiles.find(p => p.id === profileId);
     if (!profile) return;
     
     const newDays = profile.days.includes(dayIndex)
       ? profile.days.filter(d => d !== dayIndex)
       : [...profile.days, dayIndex].sort();
     
     updateSchedulerProfile(profileId, { days: newDays });
   };
   
   const handleAddTime = (profileId: string) => {
     const profile = schedulerProfiles.find(p => p.id === profileId);
     if (!profile) return;
     
     if (profile.times.length >= 5) {
       toast({
         title: "Time limit reached",
         description: "Maximum 5 posting times per profile.",
         variant: "destructive",
       });
       return;
     }
     
     const newTimes = [...profile.times, { hour: 12, minute: 0 }];
     updateSchedulerProfile(profileId, { times: newTimes });
   };
   
  const handleUpdateTime = (profileId: string, timeIndex: number, field: 'hour' | 'minute', value: number) => {
     const profile = schedulerProfiles.find(p => p.id === profileId);
     if (!profile) return;
     
     const newTimes = profile.times.map((t, i) => 
       i === timeIndex ? { ...t, [field]: value } : t
     );
    updateSchedulerProfile(profileId, { times: newTimes });
  };

  const to24Hour = (hour12: number, ampm: 'AM' | 'PM') => {
    const normalized = hour12 % 12;
    return ampm === 'AM' ? normalized : normalized + 12;
  };

  const from24Hour = (hour24: number) => {
    const hour12 = hour24 % 12 || 12;
    const ampm: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
    return { hour12, ampm };
  };

  const wrap = (value: number, min: number, max: number) => {
    const range = max - min + 1;
    return ((value - min + range) % range) + min;
  };
   
   const handleRemoveTime = (profileId: string, timeIndex: number) => {
     const profile = schedulerProfiles.find(p => p.id === profileId);
     if (!profile || profile.times.length <= 1) return;
     
     const newTimes = profile.times.filter((_, i) => i !== timeIndex);
     updateSchedulerProfile(profileId, { times: newTimes });
   };
   
  const formatTime = (time: ScheduleTime) => {
    const minute = time.minute.toString().padStart(2, '0');
    if (timeFormat === '24') {
      const hour = time.hour.toString().padStart(2, '0');
      return `${hour}:${minute}`;
    }
    const hour = time.hour % 12 || 12;
    const ampm = time.hour >= 12 ? 'PM' : 'AM';
    return `${hour}:${minute} ${ampm}`;
  };
   
   const hasConflict = (profile: SchedulerProfile) => {
     for (const other of schedulerProfiles) {
       if (other.id === profile.id || !other.enabled || !profile.enabled) continue;
       
       const sharedDays = profile.days.filter(d => other.days.includes(d));
       if (sharedDays.length === 0) continue;
       
       for (const time of profile.times) {
         for (const otherTime of other.times) {
           if (time.hour === otherTime.hour && time.minute === otherTime.minute) {
             return true;
           }
         }
       }
     }
     return false;
   };
   
   return (
     <div className="space-y-6 animate-fade-in">
       {/* Global Controls */}
       <div className="panel w-full max-w-sm">
         <div className="panel-body">
           <div className="flex items-center justify-between">
             <div className="flex items-center gap-2">
               <Label htmlFor="scheduler-toggle" className="text-sm font-medium">
                 Scheduler
               </Label>
               <Switch
                 id="scheduler-toggle"
                 checked={schedulerStatus !== 'paused'}
                 onCheckedChange={(checked) => {
                   (async () => {
                     try {
                       await api.toggleRobot();
                       setSchedulerStatus(checked ? 'ready' : 'paused');
                     } catch (e) {
                       toast({
                         title: "Update failed",
                         description: String(e),
                         variant: "destructive",
                       });
                     }
                   })();
                 }}
               />
               <span className={`w-2.5 h-2.5 rounded-full ${statusTone.className}`} />
             </div>
             <div className="text-right">
               <p className="text-xs text-muted-foreground">Daily limit</p>
               <span className="text-lg font-semibold">{postsToday}/{dailyPostLimit}</span>
             </div>
           </div>
         </div>
       </div>
       
       {/* Profiles List */}
       <div className="space-y-4">
         <div className="flex items-center justify-between">
           <h2 className="text-lg font-semibold">Profiles</h2>
           <Button onClick={handleAddProfile} size="sm" disabled={schedulerProfiles.length >= 7}>
             <Plus className="w-4 h-4 mr-1" />
             Add Profile
           </Button>
         </div>
         
         {schedulerProfiles.length === 0 ? (
           <div className="panel">
             <div className="panel-body text-center py-12">
               <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
               <p className="text-muted-foreground">No scheduler profiles</p>
               <p className="text-sm text-muted-foreground mt-1">
                 Create a profile to start scheduling posts
               </p>
             </div>
           </div>
         ) : (
           <div className="space-y-4">
             {schedulerProfiles.map((profile) => (
               <div key={profile.id} className="panel">
                 <div className="panel-header flex items-center justify-between">
                   <div className="flex items-center gap-3">
                     <Switch
                       checked={profile.enabled}
                       onCheckedChange={(checked) => 
                         updateSchedulerProfile(profile.id, { enabled: checked })
                       }
                     />
                   <Input
                     value={profile.name}
                     onChange={(e) => 
                       updateSchedulerProfile(profile.id, { name: e.target.value })
                     }
                       onBlur={async () => {
                         try {
                           const cleaned = await api.cleanInput('schedule_name', profile.name, 80);
                           if (!cleaned.valid) {
                             toast({
                               title: "Invalid name",
                               description: cleaned.reason || "Please enter a valid name.",
                               variant: "destructive",
                             });
                             return;
                           }
                           updateSchedulerProfile(profile.id, { name: cleaned.cleaned });
                         } catch {
                           // ignore
                         }
                       }}
                     className="h-8 w-48 font-medium"
                   />
                   <div className="inline-flex rounded-md border border-border bg-muted/40 p-1">
                     <Button
                       variant={profile.mode !== 'draft' ? 'default' : 'ghost'}
                       size="sm"
                       className="h-7 px-3"
                       onClick={() => updateSchedulerProfile(profile.id, { mode: 'live' })}
                     >
                       Live
                     </Button>
                     <Button
                       variant={profile.mode === 'draft' ? 'default' : 'ghost'}
                       size="sm"
                       className="h-7 px-3"
                       onClick={() => updateSchedulerProfile(profile.id, { mode: 'draft' })}
                     >
                       Draft
                     </Button>
                   </div>
                     {hasConflict(profile) && (
                       <div className="flex items-center gap-1 text-warning">
                         <AlertTriangle className="w-4 h-4" />
                         <span className="text-xs">Time conflict</span>
                       </div>
                     )}
                   </div>
                   
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => removeSchedulerProfile(profile.id)}
                     className="text-muted-foreground hover:text-destructive"
                   >
                     <Trash2 className="w-4 h-4" />
                   </Button>
                 </div>
                 
                 <div className="panel-body space-y-4">
                   {/* Days */}
                   <div>
                     <Label className="text-sm text-muted-foreground mb-2 block">Days</Label>
                     <div className="flex gap-2">
                       {DAYS.map((day, index) => (
                         <button
                           key={day}
                           onClick={() => handleToggleDay(profile.id, index)}
                           className={`w-10 h-10 rounded-md text-xs font-medium transition-colors ${
                             profile.days.includes(index)
                               ? 'bg-primary text-primary-foreground'
                               : 'bg-muted text-muted-foreground hover:bg-accent'
                           }`}
                         >
                           {day}
                         </button>
                       ))}
                     </div>
                   </div>
                   
                   {/* Times */}
                   <div>
                     <div className="flex items-center justify-between mb-2">
                       <Label className="text-sm text-muted-foreground">Times</Label>
                       <Button
                         variant="ghost"
                         size="sm"
                         onClick={() => handleAddTime(profile.id)}
                         disabled={profile.times.length >= 5}
                       >
                         <Plus className="w-3 h-3 mr-1" />
                         Add Time
                       </Button>
                     </div>
                     <div className="flex flex-wrap gap-2">
                       {profile.times.map((time, index) => (
                          <div 
                            key={index}
                            className="flex items-center gap-2 bg-muted px-3 py-2 rounded-md"
                          >
                            <Clock className="w-3 h-3 text-muted-foreground" />
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className="text-sm font-medium text-foreground hover:text-foreground/90"
                                >
                                  {formatTime(time)}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-auto p-3">
                                <div className="flex items-start gap-3">
                                  {/* Hour */}
                                  <div className="flex flex-col items-center gap-2">
                                    <span className="text-2xs text-muted-foreground">Hour</span>
                                    <input
                                      value={timeFormat === '24' ? String(time.hour).padStart(2, '0') : String(from24Hour(time.hour).hour12).padStart(2, '0')}
                                      onChange={(e) => {
                                        const raw = parseInt(e.target.value || '0', 10);
                                        if (Number.isNaN(raw)) return;
                                        if (timeFormat === '24') {
                                          handleUpdateTime(profile.id, index, 'hour', wrap(raw, 0, 23));
                                        } else {
                                          const { ampm } = from24Hour(time.hour);
                                          handleUpdateTime(profile.id, index, 'hour', to24Hour(wrap(raw, 1, 12), ampm));
                                        }
                                      }}
                                      className="w-12 rounded-md border border-border bg-background text-center text-xs font-semibold text-foreground"
                                    />
                                    <div
                                      className="max-h-36 w-14 overflow-y-auto rounded-md border border-border bg-background"
                                      onWheel={(e) => {
                                        e.preventDefault();
                                        const dir = e.deltaY > 0 ? 1 : -1;
                                        if (timeFormat === '24') {
                                          handleUpdateTime(profile.id, index, 'hour', wrap(time.hour + dir, 0, 23));
                                        } else {
                                          const { hour12, ampm } = from24Hour(time.hour);
                                          handleUpdateTime(profile.id, index, 'hour', to24Hour(wrap(hour12 + dir, 1, 12), ampm));
                                        }
                                      }}
                                    >
                                      {(timeFormat === '24'
                                        ? Array.from({ length: 24 }, (_, i) => i)
                                        : Array.from({ length: 12 }, (_, i) => i + 1)
                                      ).map((h) => {
                                        const selected = timeFormat === '24'
                                          ? time.hour === h
                                          : from24Hour(time.hour).hour12 === h;
                                        return (
                                          <button
                                            key={h}
                                            type="button"
                                            onClick={() => {
                                              if (timeFormat === '24') {
                                                handleUpdateTime(profile.id, index, 'hour', h);
                                              } else {
                                                const { ampm } = from24Hour(time.hour);
                                                handleUpdateTime(profile.id, index, 'hour', to24Hour(h, ampm));
                                              }
                                            }}
                                            className={`block w-full px-2 py-1 text-xs ${selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                                          >
                                            {String(h).padStart(2, '0')}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Minute */}
                                  <div className="flex flex-col items-center gap-2">
                                    <span className="text-2xs text-muted-foreground">Min</span>
                                    <input
                                      value={String(time.minute).padStart(2, '0')}
                                      onChange={(e) => {
                                        const raw = parseInt(e.target.value || '0', 10);
                                        if (Number.isNaN(raw)) return;
                                        handleUpdateTime(profile.id, index, 'minute', wrap(raw, 0, 59));
                                      }}
                                      className="w-12 rounded-md border border-border bg-background text-center text-xs font-semibold text-foreground"
                                    />
                                    <div
                                      className="max-h-36 w-14 overflow-y-auto rounded-md border border-border bg-background"
                                      onWheel={(e) => {
                                        e.preventDefault();
                                        const dir = e.deltaY > 0 ? 1 : -1;
                                        handleUpdateTime(profile.id, index, 'minute', wrap(time.minute + dir, 0, 59));
                                      }}
                                    >
                                      {Array.from({ length: 60 }, (_, m) => (
                                        <button
                                          key={m}
                                          type="button"
                                          onClick={() => handleUpdateTime(profile.id, index, 'minute', m)}
                                          className={`block w-full px-2 py-1 text-xs ${time.minute === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                                        >
                                          {String(m).padStart(2, '0')}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* AM/PM */}
                                  {timeFormat === '12' && (
                                    <div className="flex flex-col items-center gap-2">
                                      <span className="text-2xs text-muted-foreground">AM/PM</span>
                                      <div
                                        className="max-h-36 w-14 overflow-y-auto rounded-md border border-border bg-background"
                                        onWheel={(e) => {
                                          e.preventDefault();
                                          const { hour12, ampm } = from24Hour(time.hour);
                                          const next = ampm === 'AM' ? 'PM' : 'AM';
                                          handleUpdateTime(profile.id, index, 'hour', to24Hour(hour12, next));
                                        }}
                                      >
                                        {(['AM', 'PM'] as const).map((label) => {
                                          const selected = from24Hour(time.hour).ampm === label;
                                          return (
                                            <button
                                              key={label}
                                              type="button"
                                              onClick={() => {
                                                const { hour12 } = from24Hour(time.hour);
                                                handleUpdateTime(profile.id, index, 'hour', to24Hour(hour12, label));
                                              }}
                                              className={`block w-full px-2 py-1 text-xs ${selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                                            >
                                              {label}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>
                           {profile.times.length > 1 && (
                             <button
                               onClick={() => handleRemoveTime(profile.id, index)}
                               className="ml-1 text-muted-foreground hover:text-destructive"
                             >
                               <Trash2 className="w-3 h-3" />
                             </button>
                           )}
                         </div>
                       ))}
                     </div>
                   </div>
                 </div>
               </div>
             ))}
           </div>
         )}
       </div>
     </div>
   );
 }
