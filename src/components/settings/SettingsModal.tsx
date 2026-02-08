import { useEffect, useState } from 'react';
import { Store, Building2, Users, FileX, Target, MessageSquare, RotateCcw, Sparkles, Clock, ShieldCheck, Download } from 'lucide-react';
 import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
 } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TagInput } from '@/components/ui/tag-input';
import { Switch } from '@/components/ui/switch';
 import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
 import { 
   Select, 
   SelectContent, 
   SelectItem, 
   SelectTrigger, 
   SelectValue 
 } from '@/components/ui/select';
 import { Checkbox } from '@/components/ui/checkbox';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import type { ContentGoal, ToneStyle } from '@/types';
 
 interface SettingsModalProps {
   open: boolean;
   onOpenChange: (open: boolean) => void;
 }
 
 const CONTENT_GOALS: { value: ContentGoal; label: string }[] = [
   { value: 'traffic', label: 'Drive Traffic' },
   { value: 'sales', label: 'Increase Sales' },
   { value: 'authority', label: 'Build Authority' },
 ];
 
 const TONE_OPTIONS: { value: ToneStyle; label: string; description: string }[] = [
   { value: 'professional', label: 'Professional', description: 'Formal and business-like' },
   { value: 'friendly', label: 'Friendly', description: 'Warm and approachable' },
   { value: 'bold', label: 'Bold', description: 'Confident and direct' },
 ];
 
export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { 
    businessConfig, 
    shopifyConnected,
    topicBatchSize,
    minimumTopicThreshold,
    includeProductPosts,
    devMode,
    timeFormat,
    updateBusinessConfig, 
    disconnectShopify,
    setShopifyConnected,
    resetSetup,
    resetAllLocal,
    setActivityLog,
    setTopicQueue,
    setTopicArchive,
    setSchedulerProfiles,
    setDailyPostLimit,
    setPostsToday,
    setSchedulerStatus,
    setTopicBatchSize,
    setMinimumTopicThreshold,
    setIncludeProductPosts,
    setDevMode,
    setTimeFormat
  } = useAppStore();
  const { toast } = useToast();
  
  const [shopDomain, setShopDomain] = useState('');
  const [savingSection, setSavingSection] = useState<'business' | 'content' | null>(null);
  const [topicMin, setTopicMin] = useState<number | ''>('');
  const [topicBatch, setTopicBatch] = useState<number | ''>('');
  const [topicIncludeProducts, setTopicIncludeProducts] = useState(false);
  const [devBilling, setDevBilling] = useState(devMode.bypassBilling);
  const [devDaily, setDevDaily] = useState(devMode.bypassDailyLimit);
  const [devWizard, setDevWizard] = useState(devMode.bypassSetupWizard);
  const [systemLogLines, setSystemLogLines] = useState<string[]>([]);
  const [loadingSystemLog, setLoadingSystemLog] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);

  const normalizeShopDomain = (value: string) => {
    let cleaned = String(value || '').trim();
    if (!cleaned) return '';
    cleaned = cleaned.replace(/^https?:\/\//i, '');
    cleaned = cleaned.replace(/\/.*$/, '');
    if (cleaned.includes('?')) cleaned = cleaned.split('?')[0].trim();
    return cleaned.trim();
  };

  useEffect(() => {
    setTopicMin(minimumTopicThreshold);
    setTopicBatch(topicBatchSize);
    setTopicIncludeProducts(includeProductPosts);
  }, [minimumTopicThreshold, topicBatchSize, includeProductPosts]);

  useEffect(() => {
    setDevBilling(devMode.bypassBilling);
    setDevDaily(devMode.bypassDailyLimit);
    setDevWizard(devMode.bypassSetupWizard);
  }, [devMode.bypassBilling, devMode.bypassDailyLimit, devMode.bypassSetupWizard]);

  const loadSystemLog = async () => {
    try {
      setLoadingSystemLog(true);
      const res = await api.getSystemLog();
      setSystemLogLines(res.lines || []);
    } catch (e) {
      toast({
        title: "System log failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setLoadingSystemLog(false);
    }
  };
   
  const parseList = (value: string) =>
    String(value || '')
      .split(/\r?\n|,/g)
      .map((t) => t.trim())
      .filter(Boolean);

  const productTags = parseList(businessConfig.products);
  const setProductTags = (tags: string[]) => {
    updateBusinessConfig({ products: tags.join(', ') });
  };

  const cleanField = async (field: string, value: string, maxChars = 2000) => {
    const res = await api.cleanInput(field, value, maxChars);
    if (!res.valid) {
      toast({
        title: "Invalid input",
        description: res.reason || "Please enter a valid value.",
        variant: "destructive",
      });
      return null;
    }
    return res.cleaned || value;
  };

  const handleAddExcluded = async (raw: string) => {
    if (!raw.trim()) return;
    try {
      const cleaned = await cleanField('excluded_topic', raw.trim(), 120);
      if (cleaned === null) return;
      const newExcluded = [...businessConfig.excludedTopics, cleaned];
      updateBusinessConfig({ excludedTopics: newExcluded });
    } catch (e) {
      toast({
        title: "Add failed",
        description: String(e),
        variant: "destructive",
      });
    }
  };
   
  const handleGoalToggle = (goal: ContentGoal) => {
     const current = businessConfig.contentGoals;
     const newGoals = current.includes(goal)
       ? current.filter(g => g !== goal)
       : [...current, goal];
     updateBusinessConfig({ contentGoals: newGoals });
   };
   
  const handleResetSetup = () => {
    (async () => {
      try {
        const res = await api.resetAll();
        resetSetup();
        setActivityLog([]);
        setTopicQueue([]);
        setTopicArchive([]);
        setSchedulerProfiles([{
          id: 'default',
          name: 'Default Schedule',
          enabled: true,
          days: [1],
          times: [{ hour: 9, minute: 0 }],
        }]);
        setDailyPostLimit(3);
        setPostsToday(0);
        setSchedulerStatus('ready');
        setShopifyConnected(false);
        onOpenChange(false);
        toast({
          title: "Reset complete",
          description: "Everything was reset to defaults.",
        });
      } catch (e) {
        toast({
          title: "Reset failed",
          description: String(e),
          variant: "destructive",
        });
      }
    })();
  };
   
   return (
     <Dialog open={open} onOpenChange={onOpenChange}>
       <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
         <DialogHeader>
           <DialogTitle>Settings</DialogTitle>
         </DialogHeader>
         
         <Tabs defaultValue="business" className="flex-1 overflow-hidden flex flex-col">
           <TabsList className="w-full justify-start">
             <TabsTrigger value="business">Business</TabsTrigger>
             <TabsTrigger value="content">Content</TabsTrigger>
             <TabsTrigger value="shopify">Shopify</TabsTrigger>
             <TabsTrigger value="advanced">Advanced</TabsTrigger>
           </TabsList>
           
           <div className="flex-1 overflow-y-auto mt-4 pr-2 scrollbar-thin">
            <TabsContent value="business" className="mt-0 space-y-6">
               {/* Business Name */}
               <div className="space-y-2">
                 <Label htmlFor="business-name" className="flex items-center gap-2">
                   <Building2 className="w-4 h-4" />
                   Business Name
                 </Label>
                <Input
                  id="business-name"
                  value={businessConfig.businessName}
                  onChange={(e) => updateBusinessConfig({ businessName: e.target.value })}
                  onBlur={async () => {
                    const cleaned = await cleanField('business_name', businessConfig.businessName, 200);
                    if (cleaned !== null) updateBusinessConfig({ businessName: cleaned });
                  }}
                  placeholder="Your business name"
                />
               </div>
               
               {/* Industry */}
               <div className="space-y-2">
                 <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  value={businessConfig.industry}
                  onChange={(e) => updateBusinessConfig({ industry: e.target.value })}
                  onBlur={async () => {
                    const cleaned = await cleanField('industry', businessConfig.industry, 200);
                    if (cleaned !== null) updateBusinessConfig({ industry: cleaned });
                  }}
                  placeholder="e.g., Fashion, Electronics, Home & Garden"
                />
               </div>
               
               {/* Products */}
              <div className="space-y-2">
                <Label htmlFor="products">Products / Services</Label>
                <TagInput
                  tags={productTags}
                  onAdd={async (value) => {
                    const cleaned = await cleanField('products', value, 120);
                    if (cleaned === null) return;
                    if (cleaned.length < 2) {
                      toast({
                        title: "Too short",
                        description: "Please enter a more specific product name.",
                        variant: "destructive",
                      });
                      return;
                    }
                    setProductTags([...productTags, cleaned]);
                  }}
                  onRemove={(value) =>
                    setProductTags(productTags.filter((t) => t !== value))
                  }
                  placeholder="Add a product or service..."
                  helperText="Press Enter or comma to add items."
                  addLabel="Add"
                  tagListMaxHeight="8rem"
                />
              </div>
               
              {/* Target Customer */}
              <div className="space-y-2">
                <Label htmlFor="target" className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Target Customer
                </Label>
                <Textarea
                  id="target"
                  value={businessConfig.targetCustomer}
                  onChange={(e) => updateBusinessConfig({ targetCustomer: e.target.value })}
                  onBlur={async () => {
                    const cleaned = await cleanField('target_customer', businessConfig.targetCustomer, 300);
                    if (cleaned !== null) updateBusinessConfig({ targetCustomer: cleaned });
                  }}
                  placeholder="Describe your ideal customer..."
                  rows={3}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={async () => {
                    try {
                      setSavingSection('business');
                      const name = await api.cleanInput('business_name', businessConfig.businessName, 200);
                      if (!name.valid) throw new Error(name.reason || 'Invalid business name');
                      const industry = await api.cleanInput('industry', businessConfig.industry, 200);
                      if (!industry.valid) throw new Error(industry.reason || 'Invalid industry');
                      const products = await api.cleanInput('products', businessConfig.products, 2000);
                      if (!products.valid) throw new Error(products.reason || 'Invalid products');
                      const target = await api.cleanInput('target_customer', businessConfig.targetCustomer, 300);
                      if (!target.valid) throw new Error(target.reason || 'Invalid target customer');

                      updateBusinessConfig({
                        businessName: name.cleaned,
                        industry: industry.cleaned,
                        products: products.cleaned,
                        targetCustomer: target.cleaned,
                      });

                      await api.setupStep1(name.cleaned);
                      await api.setupStep2(industry.cleaned);
                      await api.setupStep3(products.cleaned, businessConfig.excludedTopics);
                      await api.setupStep4(target.cleaned);
                      toast({
                        title: "Saved",
                        description: "Business settings updated.",
                      });
                    } catch (e) {
                      toast({
                        title: "Save failed",
                        description: String(e),
                        variant: "destructive",
                      });
                    } finally {
                      setSavingSection(null);
                    }
                  }}
                  disabled={savingSection === 'business'}
                >
                  {savingSection === 'business' ? 'Saving...' : 'Save Business'}
                </Button>
              </div>
            </TabsContent>
             
            <TabsContent value="content" className="mt-0 space-y-6">
               {/* Excluded Topics */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileX className="w-4 h-4" />
                  Excluded Topics
                </Label>
                <p className="text-xs text-muted-foreground">
                  Topics or words the AI should never mention
                </p>
                <TagInput
                  tags={businessConfig.excludedTopics}
                  onAdd={handleAddExcluded}
                  onRemove={(value) =>
                    updateBusinessConfig({
                      excludedTopics: businessConfig.excludedTopics.filter((t) => t !== value),
                    })
                  }
                  placeholder="Add a topic to avoid..."
                  helperText="Press Enter or comma to add items."
                  addLabel="Add"
                  tagListMaxHeight="8rem"
                />
              </div>
               
               {/* Content Goals */}
               <div className="space-y-3">
                 <Label className="flex items-center gap-2">
                   <Target className="w-4 h-4" />
                   Content Goals
                 </Label>
                 <div className="space-y-2">
                   {CONTENT_GOALS.map(({ value, label }) => (
                     <div key={value} className="flex items-center gap-2">
                       <Checkbox
                         id={`goal-${value}`}
                         checked={businessConfig.contentGoals.includes(value)}
                         onCheckedChange={() => handleGoalToggle(value)}
                       />
                       <Label htmlFor={`goal-${value}`} className="font-normal cursor-pointer">
                         {label}
                       </Label>
                     </div>
                   ))}
                 </div>
               </div>
               
              {/* Tone */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Tone
                </Label>
                <div className="grid gap-2">
                  {TONE_OPTIONS.map(({ value, label, description }) => (
                    <button
                      key={value}
                      onClick={() => updateBusinessConfig({ tone: value })}
                      className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                        businessConfig.tone === value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 mt-0.5 ${
                        businessConfig.tone === value
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground'
                      }`} />
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={async () => {
                    try {
                      setSavingSection('content');
                      const products = await api.cleanInput('products', businessConfig.products, 2000);
                      if (!products.valid) throw new Error(products.reason || 'Invalid products');
                      updateBusinessConfig({ products: products.cleaned });
                      await api.setupStep3(products.cleaned, businessConfig.excludedTopics);
                      await api.setupStep5({
                        traffic: businessConfig.contentGoals.includes('traffic'),
                        sales: businessConfig.contentGoals.includes('sales'),
                        authority: businessConfig.contentGoals.includes('authority'),
                      });
                      await api.setupStep6(businessConfig.tone);
                      toast({
                        title: "Saved",
                        description: "Content settings updated.",
                      });
                    } catch (e) {
                      toast({
                        title: "Save failed",
                        description: String(e),
                        variant: "destructive",
                      });
                    } finally {
                      setSavingSection(null);
                    }
                  }}
                  disabled={savingSection === 'content'}
                >
                  {savingSection === 'content' ? 'Saving...' : 'Save Content'}
                </Button>
              </div>
            </TabsContent>
             
             <TabsContent value="shopify" className="mt-0 space-y-6">
               <div className="panel">
                 <div className="panel-body">
                   <div className="flex items-center gap-3 mb-4">
                     <Store className="w-5 h-5 text-muted-foreground" />
                     <div>
                       <p className="font-medium">Shopify Connection</p>
                       <p className="text-sm text-muted-foreground">
                         {shopifyConnected ? 'Connected to your store' : 'Not connected'}
                       </p>
                     </div>
                     <div className={`ml-auto w-2 h-2 rounded-full ${
                       shopifyConnected ? 'bg-success' : 'bg-muted-foreground'
                     }`} />
                   </div>
                   
                   {shopifyConnected ? (
                     <div className="space-y-2">
                       <Button
                         variant="outline"
                         onClick={() => {
                           (async () => {
                             try {
                               await api.testPost(true);
                               toast({
                                 title: "Test post created",
                                 description: "Published live in Shopify.",
                               });
                             } catch (e) {
                               toast({
                                 title: "Test post failed",
                                 description: String(e),
                                 variant: "destructive",
                               });
                             }
                           })();
                         }}
                         className="w-full"
                       >
                         Publish Test Post
                       </Button>
                       <Button
                         variant="outline"
                         onClick={() => {
                           (async () => {
                             try {
                               await api.disconnectShopify();
                               disconnectShopify();
                               resetAllLocal();
                               setShopifyConnected(false);
                               toast({
                                 title: "Shopify disconnected",
                                 description: "You can reconnect anytime.",
                               });
                             } catch (e) {
                               toast({
                                 title: "Disconnect failed",
                                 description: String(e),
                                 variant: "destructive",
                               });
                             }
                           })();
                         }}
                         className="w-full"
                       >
                         Disconnect Shopify
                       </Button>
                     </div>
                   ) : (
                     <div className="space-y-3">
                       <div>
                         <Label htmlFor="settings-shop-domain">Shop domain</Label>
                      <Input
                        id="settings-shop-domain"
                        placeholder="your-store.myshopify.com"
                        value={shopDomain}
                        onChange={(e) => setShopDomain(e.target.value)}
                        onBlur={async () => {
                          if (!shopDomain.trim()) return;
                          const cleaned = await cleanField('shop_domain', shopDomain, 200);
                          if (cleaned !== null) setShopDomain(cleaned);
                        }}
                      />
                       </div>
                       <Button
                         className="w-full"
                         onClick={() => {
                          const shop = normalizeShopDomain(shopDomain);
                          if (!shop || !shop.includes('.myshopify.com')) {
                            toast({
                              title: "Shop domain required",
                              description: "Enter your Shopify domain (e.g., your-store.myshopify.com).",
                              variant: "destructive",
                            });
                            return;
                          }
                          window.location.href = `/admin/shopify/oauth/start?shop=${encodeURIComponent(shop)}`;
                         }}
                       >
                         Connect Shopify
                       </Button>
                     </div>
                   )}
                 </div>
               </div>
             </TabsContent>
             
            <TabsContent value="advanced" className="mt-0 space-y-6">
              <div className="panel">
                <div className="panel-body space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-muted-foreground" />
                    <p className="font-medium">Topic Auto-Generation</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="topic-min">Generate when queue hits</Label>
                      <Input
                        id="topic-min"
                        type="number"
                        min={0}
                        value={topicMin}
                        onChange={(e) => setTopicMin(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="e.g., 3"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="topic-batch">Generate this many</Label>
                      <Input
                        id="topic-batch"
                        type="number"
                        min={1}
                        value={topicBatch}
                        onChange={(e) => setTopicBatch(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="e.g., 5"
                      />
                    </div>
                  </div>
                  <label className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <span>Include product-related topics in generator</span>
                    <Switch
                      checked={topicIncludeProducts}
                      onCheckedChange={setTopicIncludeProducts}
                    />
                  </label>
                  <div className="flex justify-end">
                    <Button
                      onClick={async () => {
                        try {
                          const min = typeof topicMin === 'number' ? topicMin : undefined;
                          const batch = typeof topicBatch === 'number' ? topicBatch : undefined;
                          if (typeof min !== 'number' || typeof batch !== 'number') {
                            toast({
                              title: "Values required",
                              description: "Enter both numbers before saving.",
                              variant: "destructive",
                            });
                            return;
                          }
                          const res = await api.updateTopicGen(min, batch, topicIncludeProducts);
                          setMinimumTopicThreshold(min);
                          setTopicBatchSize(batch);
                          setIncludeProductPosts(topicIncludeProducts);
                          if ((res as any).autoGenerated > 0) {
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
                              description: `Auto-generated ${(res as any).autoGenerated} topics.`,
                            });
                          }
                          toast({
                            title: "Saved",
                            description: "Topic generation settings updated.",
                          });
                        } catch (e) {
                          toast({
                            title: "Save failed",
                            description: String(e),
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      Save Topic Settings
                    </Button>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-body space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <p className="font-medium">Time Display</p>
                  </div>
                  <label className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <span>Use 24-hour clock</span>
                    <Switch
                      checked={timeFormat === '24'}
                      onCheckedChange={(checked) => setTimeFormat(checked ? '24' : '12')}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Applies to the header clock and scheduling display.
                  </p>
                </div>
              </div>

              <div className="panel">
                <div className="panel-body space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                    <p className="font-medium">Data &amp; Privacy</p>
                  </div>
                  <div className="grid gap-2 text-sm">
                    <a className="text-muted-foreground hover:text-foreground" href="/privacy.html" target="_blank" rel="noreferrer">
                      Privacy Policy
                    </a>
                    <a className="text-muted-foreground hover:text-foreground" href="/dpa.html" target="_blank" rel="noreferrer">
                      Data Processing Addendum (DPA)
                    </a>
                    <a className="text-muted-foreground hover:text-foreground" href="/retention.html" target="_blank" rel="noreferrer">
                      Data Retention Policy
                    </a>
                    <a className="text-muted-foreground hover:text-foreground" href="/security.html" target="_blank" rel="noreferrer">
                      Security Policy
                    </a>
                    <a className="text-muted-foreground hover:text-foreground" href="/incident-response.html" target="_blank" rel="noreferrer">
                      Incident Response Policy
                    </a>
                    <a className="text-muted-foreground hover:text-foreground" href="/dlp.html" target="_blank" rel="noreferrer">
                      Data Loss Prevention Policy
                    </a>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <span>Data export</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          setBackupLoading(true);
                          const res = await api.createBackup();
                          toast({
                            title: "Backup created",
                            description: `Saved as ${res.filename}`,
                          });
                        } catch (e) {
                          toast({
                            title: "Backup failed",
                            description: String(e),
                            variant: "destructive",
                          });
                        } finally {
                          setBackupLoading(false);
                        }
                      }}
                      disabled={backupLoading}
                    >
                      <Download className="w-4 h-4 mr-1" />
                      {backupLoading ? "Creating..." : "Create Backup"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Backups include configuration, activity, and logs for this shop.
                  </p>
                </div>
              </div>

              <div className="panel border-destructive/20">
                <div className="panel-body">
                  <div className="flex items-start gap-3">
                    <RotateCcw className="w-5 h-5 text-destructive mt-0.5" />
                     <div className="flex-1">
                       <p className="font-medium text-destructive">Reset Setup</p>
                       <p className="text-sm text-muted-foreground mt-1">
                         This will clear all your settings and require you to complete the setup wizard again.
                       </p>
                       <Button
                         variant="destructive"
                         size="sm"
                         onClick={handleResetSetup}
                         className="mt-3"
                       >
                         Reset Everything
                       </Button>
                     </div>
                   </div>
                </div>
              </div>

              <div className="panel border-destructive/60 bg-destructive/5">
                <div className="panel-body space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-destructive" />
                    <p className="font-medium text-destructive">DEV MODE (REMOVE BEFORE LAUNCH)</p>
                  </div>
                  <div className="grid gap-3">
                    <label className="flex items-center justify-between rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm">
                      <span>Bypass billing / paywall</span>
                      <Switch
                        checked={devBilling}
                        onCheckedChange={async (checked) => {
                          try {
                            setDevBilling(checked);
                            const res = await api.setDevMode({
                              bypassBilling: checked,
                              bypassDailyLimit: devDaily,
                              bypassSetupWizard: devWizard,
                            });
                            setDevMode({
                              bypassBilling: !!res.devMode?.bypassBilling,
                              bypassDailyLimit: !!res.devMode?.bypassDailyLimit,
                              bypassSetupWizard: !!res.devMode?.bypassSetupWizard,
                            });
                          } catch {
                            // ignore
                          }
                        }}
                      />
                    </label>
                    <label className="flex items-center justify-between rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm">
                      <span>Bypass daily post limit</span>
                      <Switch
                        checked={devDaily}
                        onCheckedChange={async (checked) => {
                          try {
                            setDevDaily(checked);
                            const res = await api.setDevMode({
                              bypassBilling: devBilling,
                              bypassDailyLimit: checked,
                              bypassSetupWizard: devWizard,
                            });
                            setDevMode({
                              bypassBilling: !!res.devMode?.bypassBilling,
                              bypassDailyLimit: !!res.devMode?.bypassDailyLimit,
                              bypassSetupWizard: !!res.devMode?.bypassSetupWizard,
                            });
                          } catch {
                            // ignore
                          }
                        }}
                      />
                    </label>
                    <label className="flex items-center justify-between rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm">
                      <span>Bypass setup wizard</span>
                      <Switch
                        checked={devWizard}
                        onCheckedChange={async (checked) => {
                          try {
                            setDevWizard(checked);
                            const res = await api.setDevMode({
                              bypassBilling: devBilling,
                              bypassDailyLimit: devDaily,
                              bypassSetupWizard: checked,
                            });
                            setDevMode({
                              bypassBilling: !!res.devMode?.bypassBilling,
                              bypassDailyLimit: !!res.devMode?.bypassDailyLimit,
                              bypassSetupWizard: !!res.devMode?.bypassSetupWizard,
                            });
                          } catch {
                            // ignore
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-body space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">System Log</p>
                      <p className="text-xs text-muted-foreground">
                        Records every action and response for this shop.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadSystemLog}
                      disabled={loadingSystemLog}
                    >
                      {loadingSystemLog ? 'Loading...' : 'Refresh'}
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-muted/20 p-3 text-xs whitespace-pre-wrap">
                    {systemLogLines.length > 0 ? systemLogLines.join("\n") : "No log entries yet."}
                  </div>
                </div>
              </div>
            </TabsContent>
           </div>
         </Tabs>
       </DialogContent>
     </Dialog>
   );
 }
