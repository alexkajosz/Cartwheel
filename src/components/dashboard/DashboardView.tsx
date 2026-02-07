import { useEffect, useMemo, useRef, useState } from 'react';
import RGL, { useContainerWidth } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import {
  TrendingUp,
  Calendar,
  FileText,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { format } from 'date-fns';

const DEFAULT_LAYOUT: Layout[] = [
  { i: 'scheduler', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'posts', x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'queue', x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'actions', x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'activity', x: 0, y: 2, w: 12, h: 2, minW: 6, minH: 2 },
  { i: 'upcoming', x: 0, y: 4, w: 12, h: 5, minW: 6, minH: 5 },
];

interface DashboardViewProps {
  onNavigate: (view: string) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const {
    schedulerStatus,
    topicQueue,
    activityLog,
    postsToday,
    dailyPostLimit,
    timezone,
    timeFormat,
    schedulerProfiles,
    setTopicQueue,
    setTopicArchive
  } = useAppStore();
  const { toast } = useToast();
  const [isPosting, setIsPosting] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewContent, setPreviewContent] = useState<Record<string, string>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editMessage, setEditMessage] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [layout, setLayout] = useState<Layout[]>(DEFAULT_LAYOUT);
  const [clockNow, setClockNow] = useState(new Date());
  const typingTimerRef = useRef<number | null>(null);
  const { containerRef, width } = useContainerWidth();

  const enabledProfiles = schedulerProfiles.filter(p => p.enabled).length;
  const recentLogs = activityLog.slice(0, 5);
  const nextTopics = useMemo(() => topicQueue.slice(0, 3), [topicQueue]);
  const activeTopic = nextTopics[previewIndex]?.title || '';
  const lastPost = activityLog.find((log) => log.type === 'posted');
  const lastOutcome = useMemo(
    () => activityLog.find((log) => log.type === 'posted' || log.type === 'error'),
    [activityLog]
  );
  const statusDisplay = useMemo(() => {
    if (schedulerStatus === 'posting') {
      return { label: 'Posting', dotClass: 'bg-status-posting animate-pulse-subtle' };
    }
    if (schedulerStatus === 'paused') {
      return { label: 'Paused', dotClass: 'bg-status-paused' };
    }
    const lastTs = lastOutcome?.timestamp ? new Date(lastOutcome.timestamp).getTime() : 0;
    const ageMs = Date.now() - lastTs;
    if (lastOutcome?.type === 'error' && ageMs < 6000) {
      return { label: 'Failed', dotClass: 'bg-status-failed' };
    }
    if (lastOutcome?.type === 'posted' && ageMs < 6000) {
      return { label: 'Success!', dotClass: 'bg-status-success' };
    }
    return { label: 'Ready', dotClass: 'bg-status-ready' };
  }, [schedulerStatus, lastOutcome]);

  const effectiveTimezone = useMemo(() => {
    if (timezone) return timezone;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, [timezone]);

  const timezoneTime = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: effectiveTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: timeFormat === '12',
      }).format(clockNow);
    } catch {
      return format(clockNow, timeFormat === '24' ? 'HH:mm' : 'h:mm a');
    }
  }, [clockNow, effectiveTimezone, timeFormat]);

  const nextSchedule = useMemo(() => {
    if (schedulerProfiles.length === 0) return null;
    const now = new Date();
    let best: { when: Date; profileName: string } | null = null;
    for (const profile of schedulerProfiles) {
      if (!profile.enabled || profile.days.length === 0 || profile.times.length === 0) continue;
      for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
        const candidate = new Date(now);
        candidate.setDate(now.getDate() + dayOffset);
        const weekday = candidate.getDay();
        if (!profile.days.includes(weekday)) continue;
        for (const time of profile.times) {
          const when = new Date(candidate);
          when.setHours(time.hour, time.minute, 0, 0);
          if (when <= now) continue;
          if (!best || when < best.when) {
            best = { when, profileName: profile.name };
          }
        }
      }
    }
    return best;
  }, [schedulerProfiles]);

  const nextScheduleLabel = useMemo(() => {
    if (!nextSchedule) return '';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: effectiveTimezone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: timeFormat === '12',
      }).format(nextSchedule.when);
    } catch {
      return format(nextSchedule.when, timeFormat === '24' ? 'MMM d, HH:mm' : 'MMM d, h:mm a');
    }
  }, [nextSchedule, effectiveTimezone, timeFormat]);

  useEffect(() => {
    if (previewIndex > Math.max(nextTopics.length - 1, 0)) {
      setPreviewIndex(0);
    }
  }, [previewIndex, nextTopics.length]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockNow(new Date());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const handleLayoutChange = (nextLayout: Layout[]) => {
    setLayout(nextLayout);
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'posted':
        return <CheckCircle2 className="w-4 h-4 text-success" />;
      case 'skipped':
        return <Clock className="w-4 h-4 text-warning" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-destructive" />;
      default:
        return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const typewriter = (topicKey: string, text: string) => {
    if (typingTimerRef.current) {
      window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    setPreviewContent((prev) => ({ ...prev, [topicKey]: '' }));
    let i = 0;
    typingTimerRef.current = window.setInterval(() => {
      i += 4;
      setPreviewContent((prev) => ({ ...prev, [topicKey]: text.slice(0, i) }));
      if (i >= text.length) {
        if (typingTimerRef.current) window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    }, 10);
  };

  const ensurePreview = async (topicTitle: string) => {
    if (!topicTitle) return;
    if (previewContent[topicTitle]) return;
    try {
      const res = await api.previewGenerate(topicTitle);
      setPreviewContent((prev) => ({ ...prev, [topicTitle]: res.content }));
    } catch (e) {
      toast({
        title: "Preview failed",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    const titles = nextTopics.map(t => t.title).filter(Boolean);
    if (titles.length === 0) return;
    (async () => {
      try {
        const cached = await api.previewBatch(titles, true);
        const cachedPreviews = cached.previews || {};
        if (Object.keys(cachedPreviews).length > 0) {
          setPreviewContent((prev) => ({ ...prev, ...cachedPreviews }));
        }
        const missing = titles.filter((t) => !cachedPreviews[t]);
        if (missing.length > 0) {
          const res = await api.previewBatch(missing);
          const previews = res.previews || {};
          setPreviewContent((prev) => ({ ...prev, ...previews }));
        }
      } catch {
        // best-effort
      }
    })();
  }, [nextTopics]);

  const renderPreview = (content: string) => {
    const lines = content.split(/\r?\n/);
    const blocks: Array<{ type: 'h1' | 'h2' | 'h3' | 'p' | 'li'; text: string }> = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('# ')) blocks.push({ type: 'h1', text: line.slice(2).trim() });
      else if (line.startsWith('## ')) blocks.push({ type: 'h2', text: line.slice(3).trim() });
      else if (line.startsWith('### ')) blocks.push({ type: 'h3', text: line.slice(4).trim() });
      else if (line.startsWith('- ') || line.startsWith('* ')) blocks.push({ type: 'li', text: line.slice(2).trim() });
      else blocks.push({ type: 'p', text: line });
    }
    return (
      <div className="space-y-3">
        {blocks.map((b, i) => {
          if (b.type === 'h1') return <h3 key={i} className="text-lg font-semibold">{b.text}</h3>;
          if (b.type === 'h2') return <h4 key={i} className="text-base font-semibold">{b.text}</h4>;
          if (b.type === 'h3') return <h5 key={i} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{b.text}</h5>;
          if (b.type === 'li') return <li key={i} className="ml-4 list-disc text-sm">{b.text}</li>;
          return <p key={i} className="text-sm leading-relaxed text-foreground/90">{b.text}</p>;
        })}
      </div>
    );
  };

  return (
    <div className="animate-fade-in">
      <div ref={containerRef}>
        <RGL
          className="layout"
          layout={layout}
          onLayoutChange={handleLayoutChange}
          cols={12}
          rowHeight={20}
          margin={[16, 16]}
          isResizable
          width={width || 1200}
          draggableCancel="button, input, textarea, select, .no-drag"
        >
        <div key="scheduler" className="h-full">
          <div className="panel h-full">
            <div className="panel-body h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-muted-foreground">Scheduler</span>
                <Calendar className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${statusDisplay.dotClass}`} />
                <span className="text-lg font-semibold">{statusDisplay.label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {enabledProfiles} active profile{enabledProfiles !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {timezoneTime} ({effectiveTimezone})
              </p>
              <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
                {nextSchedule ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Next scheduled post</p>
                    <p className="text-sm font-medium">
                      {nextScheduleLabel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {nextTopics[0]?.title ? nextTopics[0].title : 'No topic queued'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {enabledProfiles > 0 ? 'No upcoming time' : 'No active schedule'}
                    </p>
                    {enabledProfiles > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Check days and times in Scheduler.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div key="posts" className="h-full">
          <div className="panel h-full">
            <div className="panel-body h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-muted-foreground">Posts Today</span>
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold">{postsToday}</span>
                <span className="text-sm text-muted-foreground">/ {dailyPostLimit}</span>
              </div>
              <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand transition-all duration-300"
                  style={{ width: `${Math.min((postsToday / dailyPostLimit) * 100, 100)}%` }}
                />
              </div>
              <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
                {lastPost ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Last post</p>
                    <p className="text-sm font-medium">
                      {format(new Date(lastPost.timestamp), 'MMM d, h:mm a')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lastPost.message}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No posts yet today</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div key="queue" className="h-full">
          <div className="panel h-full">
            <div className="panel-body h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-muted-foreground">Topic Queue</span>
                <FileText className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className="text-2xl font-semibold">{topicQueue.length}</span>
              <p className="text-xs text-muted-foreground mt-1">
                {topicQueue.length < 3 ? 'Low - consider adding more' : 'Healthy queue'}
              </p>
              <div className="mt-4 border-t border-border/60 pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Next up: {topicQueue[0]?.title ? topicQueue[0].title : 'No topic queued'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div key="actions" className="h-full">
          <div className="panel h-full">
            <div className="panel-body h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-muted-foreground">Quick Actions</span>
              </div>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between"
                  onClick={async () => {
                    try {
                      setIsPosting(true);
                      const res = await api.postSeo();
                      if (res.skipped) {
                        toast({
                          title: "Post skipped",
                          description: res.reason || "No post created.",
                          variant: "destructive",
                        });
                        return;
                      }
                      toast({
                        title: "Post created",
                        description: res.title ? `"${res.title}"` : "Draft post created.",
                      });
                    } catch (e) {
                      toast({
                        title: "Post failed",
                        description: String(e),
                        variant: "destructive",
                      });
                    } finally {
                      setIsPosting(false);
                    }
                  }}
                  disabled={isPosting}
                >
                  {isPosting ? 'Generating...' : 'Generate Post Now'}
                  <ArrowRight className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => onNavigate('topics')}
                >
                  Add Topics
                  <ArrowRight className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => {
                    onNavigate('topics');
                    toast({
                      title: "Generate a product post",
                      description: "Choose a product in Topics to generate a product post.",
                    });
                  }}
                >
                  Generate Product Post
                  <ArrowRight className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => onNavigate('scheduler')}
                >
                  View Schedules
                  <ArrowRight className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div key="upcoming" className="h-full">
          <div className="panel h-full flex flex-col">
            <div className="panel-header flex items-center justify-between">
              <h2 className="font-semibold">Upcoming Posts</h2>
              <div className="flex items-center gap-2">
                {nextTopics.length > 0 && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPreviewIndex((i) => (i - 1 + nextTopics.length) % nextTopics.length)}
                    >
                      &lt;
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPreviewIndex((i) => (i + 1) % nextTopics.length)}
                    >
                      &gt;
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="panel-body flex-1 overflow-hidden">
                {nextTopics.length === 0 ? (
                  <div className="text-center py-6 space-y-3">
                    <p className="text-sm text-muted-foreground">No topics in the queue.</p>
                    <p className="text-xs text-muted-foreground">
                      Use auto generator or generate now to keep the queue full.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await api.generateTopics();
                          const updated = await api.getTopics();
                          const updatedQueue = updated.topics.map((t: any, i: number) => ({
                            id: `topic-${i}`,
                            title: String(t?.title ?? t ?? ''),
                            intent: (t?.intent || 'informational') as any,
                            createdAt: new Date(),
                          }));
                          const updatedArchive = (updated.archive || []).map((t: any, i: number) => ({
                            id: String(t.articleId || `archive-${i}`),
                            title: String(t.topic || t.title || ''),
                            intent: (t.intent || 'informational') as any,
                            createdAt: new Date(t.postedAt || Date.now()),
                            usedAt: t.postedAt ? new Date(t.postedAt) : undefined,
                          }));
                          setTopicQueue(updatedQueue);
                          setTopicArchive(updatedArchive);
                          toast({
                            title: "Topics generated",
                            description: "New topics were added to the queue.",
                          });
                        } catch (e) {
                          toast({
                            title: "Generate failed",
                            description: String(e),
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      Generate Topics Now
                    </Button>
                  </div>
                ) : (
                  <div className="flex h-full flex-col space-y-3">
                    <div className="text-sm font-medium">{activeTopic}</div>
                    <div className="flex-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-4">
                      {previewContent[activeTopic] ? renderPreview(previewContent[activeTopic]) : (
                        <span className="text-sm text-muted-foreground">Generating preview...</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <Button
                        size="sm"
                        onClick={async () => {
                          await ensurePreview(activeTopic);
                          setEditOpen(true);
                        }}
                        disabled={!activeTopic}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                )}
              </div>
          </div>
        </div>

        <div key="activity" className="h-full">
          <div className="panel h-full flex flex-col">
            <div className="panel-header flex items-center justify-between">
              <h2 className="font-semibold">Recent Activity</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('activity')}
              >
                View All
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
            <div className="panel-body flex-1 overflow-y-auto">
              {recentLogs.length > 0 ? (
                <div className="space-y-0">
                  {recentLogs.map((log) => (
                    <div key={log.id} className="log-item">
                      {getLogIcon(log.type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">{log.message}</p>
                        {log.details && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {log.details}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.timestamp), 'MMM d, h:mm a')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No activity yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Activity will appear here once the scheduler runs
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        </RGL>
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-3xl rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Edit Preview</p>
                <p className="text-xs text-muted-foreground">{activeTopic}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>
                Close
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Chat</Label>
                <Textarea
                  placeholder="Describe the edits you want..."
                  value={editMessage}
                  onChange={(e) => setEditMessage(e.target.value)}
                  rows={6}
                />
                <Button
                  onClick={async () => {
                    if (!activeTopic || !previewContent[activeTopic]) return;
                    if (!editMessage.trim()) return;
                    try {
                      setIsEditing(true);
                      const res = await api.previewEdit(activeTopic, previewContent[activeTopic], editMessage.trim());
                      typewriter(activeTopic, res.content);
                      setEditMessage('');
                    } catch (e) {
                      toast({
                        title: "Edit failed",
                        description: String(e),
                        variant: "destructive",
                      });
                    } finally {
                      setIsEditing(false);
                    }
                  }}
                  disabled={isEditing || !editMessage.trim()}
                >
                  {isEditing ? 'Applying...' : 'Apply Edit'}
                </Button>
              </div>
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Live Preview</Label>
                <div className="max-h-96 overflow-y-auto rounded-md border border-border bg-muted/20 p-4">
                  {previewContent[activeTopic] ? renderPreview(previewContent[activeTopic]) : 'No preview yet.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
