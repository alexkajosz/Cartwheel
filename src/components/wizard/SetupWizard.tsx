import { useEffect, useRef, useState } from 'react';
 import { motion, AnimatePresence } from 'framer-motion';
 import { 
   Store, 
   Wand2, 
   Building2, 
   Briefcase, 
   Package, 
   FileX, 
   Users, 
   Target, 
   MessageSquare,
   CheckCircle2,
   ArrowRight,
   ArrowLeft,
   Loader2,
   Zap
 } from 'lucide-react';
import {
   Dialog,
   DialogContent,
   DialogTitle,
   DialogDescription,
 } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { TagInput } from '@/components/ui/tag-input';
import { Switch } from '@/components/ui/switch';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import type { ContentGoal, ToneStyle, ContentIntent } from '@/types';
import { Progress } from '@/components/ui/progress';
 
 interface SetupWizardProps {
   open: boolean;
 }
 
 const WIZARD_STEPS = [
   { id: 'shopify', title: 'Connect Shopify', icon: Store },
   { id: 'autofill', title: 'Setup Method', icon: Wand2 },
   { id: 'loading', title: 'Preparing', icon: Loader2 },
   { id: 'business', title: 'Business Name', icon: Building2 },
   { id: 'industry', title: 'Industry', icon: Briefcase },
   { id: 'products', title: 'Products', icon: Package },
  { id: 'excluded', title: 'Excluded Topics', icon: FileX },
  { id: 'customer', title: 'Target Customer', icon: Users },
  { id: 'goals', title: 'Content Goals', icon: Target },
  { id: 'intent', title: 'Content Intent', icon: Target },
  { id: 'tone', title: 'Tone', icon: MessageSquare },
  { id: 'review', title: 'Review', icon: CheckCircle2 },
];
 
 const TONE_OPTIONS: { value: ToneStyle; label: string; description: string }[] = [
   { value: 'professional', label: 'Professional', description: 'Formal and business-like' },
   { value: 'friendly', label: 'Friendly', description: 'Warm and approachable' },
   { value: 'bold', label: 'Bold', description: 'Confident and direct' },
 ];
 
export function SetupWizard({ open }: SetupWizardProps) {
  const { 
    businessConfig,
    updateBusinessConfig,
    shopifyConnected,
    shopifyData,
    shopDomainInput,
    wizardStep,
    setWizardStep,
    autofillCompleted,
    setAutofillCompleted,
    setupComplete,
    completeSetup,
    setSetupComplete,
    resetAllLocal,
    setShopifyConnected,
    setShopDomainInput,
    addLogEntry,
    contentIntentDefault,
    setContentIntentDefault,
    devMode,
    setDevMode,
    billing
  } = useAppStore();
  const { toast } = useToast();
  
  const [step, setStep] = useState(0);
  const shopDomain = shopDomainInput;
  const [autofillChoice, setAutofillChoice] = useState<'auto' | 'manual' | null>(null);
  const [intentChoice, setIntentChoice] = useState<ContentIntent>(contentIntentDefault);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isSuggestingCustomer, setIsSuggestingCustomer] = useState(false);
  const [forceLoginNext, setForceLoginNext] = useState(false);
  const [isSavingStep, setIsSavingStep] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizingProgress, setFinalizingProgress] = useState(0);
  const didResetOnMount = useRef(false);
  const suggestedOnceRef = useRef(false);
  const [devBilling, setDevBilling] = useState(devMode.bypassBilling);
  const [devDaily, setDevDaily] = useState(devMode.bypassDailyLimit);
  const devWizard = devMode.bypassSetupWizard;
   
  const currentStep = WIZARD_STEPS[step];
  const progress = ((step + 1) / WIZARD_STEPS.length) * 100;

  useEffect(() => {
    if (contentIntentDefault) {
      setIntentChoice(contentIntentDefault);
    }
  }, [contentIntentDefault]);

  useEffect(() => {
    if (!didResetOnMount.current && !setupComplete) {
      didResetOnMount.current = true;
      setStep(0);
      setWizardStep(0);
    }
  }, [setupComplete, setWizardStep]);


  useEffect(() => {
    if (Number.isInteger(wizardStep) && wizardStep !== step) {
      setStep(wizardStep);
    }
  }, [wizardStep, step]);

  useEffect(() => {
    if (currentStep.id === 'customer' && !businessConfig.targetCustomer.trim()) {
      (async () => {
        try {
          setIsSuggestingCustomer(true);
          const res = await api.suggestTargetCustomer();
          if (res?.target_customer) {
            updateBusinessConfig({ targetCustomer: res.target_customer });
          }
        } catch {
          // best-effort
        } finally {
          setIsSuggestingCustomer(false);
        }
      })();
    }
  }, [currentStep.id, businessConfig.targetCustomer, updateBusinessConfig]);

  useEffect(() => {
    if (!shopifyConnected) return;
    if (businessConfig.targetCustomer.trim()) return;
    if (suggestedOnceRef.current) return;
    suggestedOnceRef.current = true;
    (async () => {
      try {
        const res = await api.suggestTargetCustomer();
        if (res?.target_customer) {
          updateBusinessConfig({ targetCustomer: res.target_customer });
        }
      } catch {
        // best-effort
      }
    })();
  }, [shopifyConnected, businessConfig.targetCustomer, updateBusinessConfig]);

  useEffect(() => {
    setDevBilling(devMode.bypassBilling);
    setDevDaily(devMode.bypassDailyLimit);
  }, [devMode.bypassBilling, devMode.bypassDailyLimit]);

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

  const normalizeShopDomain = (value: string) => {
    let cleaned = String(value || '').trim();
    if (!cleaned) return '';
    cleaned = cleaned.replace(/^https?:\/\//i, '');
    cleaned = cleaned.replace(/\/.*$/, '');
    if (cleaned.includes('?')) cleaned = cleaned.split('?')[0].trim();
    return cleaned.trim();
  };

  const startOAuth = (force = false) => {
    const shop = normalizeShopDomain(shopDomain);
    if (!shop || !shop.includes('.myshopify.com')) {
      toast({
        title: "Shop domain required",
        description: "Enter your Shopify domain (e.g., your-store.myshopify.com).",
        variant: "destructive",
      });
      return;
    }
    const forceParam = force ? '&force=1' : '';
    window.location.href = `/admin/shopify/oauth/start?shop=${encodeURIComponent(shop)}${forceParam}`;
  };

  const localProductStop = new Set([
    'and',
    'or',
    'with',
    'the',
    'a',
    'an',
    'bold',
    'flavorful',
    'energy',
    'focus',
    'wellness',
    'boost',
    'power',
    'performance',
  ]);

  const cleanProductTagLocal = (value: string) => {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    const lower = cleaned.toLowerCase();
    if (cleaned.length < 2) return null;
    if (localProductStop.has(lower)) return null;
    if (lower.startsWith('and ') || lower.startsWith('or ')) return null;
    return cleaned;
  };

  const normalizeProductTags = (tags: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tag of tags) {
      const cleaned = cleanProductTagLocal(tag);
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
    return out;
  };

  const applyServerConfig = (cfg: any) => {
    const bc = cfg?.businessContext || {};
    const goals = bc.goals || {};

    const contentGoals: ContentGoal[] = [];
    if (goals.traffic) contentGoals.push('traffic');
    if (goals.sales) contentGoals.push('sales');
    if (goals.authority) contentGoals.push('authority');

    updateBusinessConfig({
      businessName: String(bc.business_name || ''),
      industry: String(bc.industry || ''),
      products: String(bc.products || bc.products_raw || ''),
      excludedTopics: Array.isArray(cfg.excludedTopics) ? cfg.excludedTopics : [],
      targetCustomer: String(bc.target_customer || ''),
      contentGoals,
      tone: (bc.tone || 'professional'),
    });
    if (cfg?.contentIntentDefault) {
      setContentIntentDefault(cfg.contentIntentDefault);
      setIntentChoice(cfg.contentIntentDefault);
    } else if (bc?.content_intent_default) {
      setContentIntentDefault(bc.content_intent_default);
      setIntentChoice(bc.content_intent_default);
    }

    if (bc.status === 'initialized') {
      setSetupComplete(true);
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
  
  const canProceed = () => {
    switch (currentStep.id) {
      case 'shopify':
        return true; // Will handle connection
       case 'autofill':
         return autofillChoice !== null;
       case 'loading':
         return !isLoading;
       case 'business':
         return businessConfig.businessName.trim().length > 0;
       case 'industry':
         return businessConfig.industry.trim().length > 0;
       case 'products':
         return businessConfig.products.trim().length > 0;
       case 'excluded':
         return (
           <div className="space-y-6">
             <div className="text-center">
               <h2 className="text-xl font-semibold mb-2">Any topics to avoid?</h2>
               <p className="text-muted-foreground">
                 Words or topics the AI should never mention (optional)
               </p>
             </div>
            <div className="max-w-md mx-auto">
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
              />
            </div>
          </div>
        );

       case 'customer':
         return businessConfig.targetCustomer.trim().length > 0;
       case 'goals':
         return businessConfig.contentGoals.length > 0;
       case 'intent':
         return true;
       case 'tone':
         return businessConfig.tone !== undefined;
       case 'review':
         return true;
       default:
         return false;
     }
   };
   
  const handleNext = async () => {
    if (isSavingStep) return;
    if (currentStep.id === 'shopify') {
      if (shopifyConnected) {
        setStep(step + 1);
        setWizardStep(step + 1);
        return;
      }

      // Redirect to backend OAuth start (will return to frontend)
      startOAuth(forceLoginNext);
      if (forceLoginNext) setForceLoginNext(false);
      return;
    }
    
    if (currentStep.id === 'autofill' && autofillChoice === 'auto') {
      if (autofillCompleted) {
        setStep(step + 2); // Skip loading if already done
        setWizardStep(step + 2);
      } else {
        setStep(step + 1); // Go to loading
        setWizardStep(step + 1);
        simulateAutofill(step + 2);
      }
      return;
    }
    
    if (currentStep.id === 'autofill' && autofillChoice === 'manual') {
      setStep(step + 2); // Skip loading
      setWizardStep(step + 2);
      return;
    }
     
     if (currentStep.id === 'review') {
       handleComplete();
       return;
     }
     
    // Persist each step to backend (with AI cleaning)
    try {
      setIsSavingStep(true);
      if (currentStep.id === 'business') {
        const cleaned = await cleanField('business_name', businessConfig.businessName, 200);
        if (cleaned === null) return;
        updateBusinessConfig({ businessName: cleaned });
        const res = await api.setupStep1(cleaned);
        applyServerConfig(res.config);
      } else if (currentStep.id === 'industry') {
        const cleaned = await cleanField('industry', businessConfig.industry, 200);
        if (cleaned === null) return;
        updateBusinessConfig({ industry: cleaned });
        const res = await api.setupStep2(cleaned);
        applyServerConfig(res.config);
      } else if (currentStep.id === 'products') {
        const normalized = normalizeProductTags(productTags);
        if (!normalized.length) {
          toast({
            title: "Missing products",
            description: "Please add at least one product or service.",
            variant: "destructive",
          });
          return;
        }
        const joined = normalized.join(', ');
        updateBusinessConfig({ products: joined });
        const res = await api.setupStep3(joined, businessConfig.excludedTopics);
        applyServerConfig(res.config);
      } else if (currentStep.id === 'customer') {
        const cleaned = await cleanField('target_customer', businessConfig.targetCustomer, 300);
        if (cleaned === null) return;
        updateBusinessConfig({ targetCustomer: cleaned });
        const res = await api.setupStep4(cleaned);
        applyServerConfig(res.config);
      } else if (currentStep.id === 'goals') {
        const res = await api.setupStep5({
          traffic: businessConfig.contentGoals.includes('traffic'),
          sales: businessConfig.contentGoals.includes('sales'),
          authority: businessConfig.contentGoals.includes('authority'),
        });
        applyServerConfig(res.config);
      } else if (currentStep.id === 'intent') {
        setContentIntentDefault(intentChoice);
        const res = await api.setupIntent(intentChoice);
        applyServerConfig(res.config);
      } else if (currentStep.id === 'tone') {
        const res = await api.setupStep6(businessConfig.tone);
        applyServerConfig(res.config);
      }
    } catch (e) {
      toast({
        title: "Save failed",
        description: String(e),
        variant: "destructive",
      });
      return;
    } finally {
      setIsSavingStep(false);
    }

    setStep(step + 1);
    setWizardStep(step + 1);
  };
   
  const handleBack = () => {
    if (step > 0) {
      // Skip loading step when going back
      if (WIZARD_STEPS[step - 1].id === 'loading') {
        setStep(step - 2);
        setWizardStep(step - 2);
      } else {
        setStep(step - 1);
        setWizardStep(step - 1);
      }
    }
  };
   
  const simulateAutofill = async (nextStep: number) => {
    setIsLoading(true);
    setLoadingProgress(0);

    const tick = setInterval(() => {
      setLoadingProgress((prev) => (prev < 99 ? prev + 1 : prev));
    }, 80);

    try {
      const res = await api.setupAutopopulate();
      applyServerConfig(res.config);
      setAutofillCompleted(true);
      setLoadingProgress(100);
      await new Promise(resolve => setTimeout(resolve, 120));
    } catch (e) {
      toast({
        title: "Autofill failed",
        description: String(e),
        variant: "destructive",
      });
    }
    clearInterval(tick);

    setIsLoading(false);
    setStep(nextStep);
    setWizardStep(nextStep);
  };

  const handleComplete = () => {
    (async () => {
      try {
        setIsFinalizing(true);
        setStep(WIZARD_STEPS.findIndex((s) => s.id === 'loading'));
        setWizardStep(WIZARD_STEPS.findIndex((s) => s.id === 'loading'));
        setFinalizingProgress(0);
        const progTimer = window.setInterval(() => {
          setFinalizingProgress((p) => (p < 95 ? p + 1 : p));
        }, 60);

        const res = await api.setupFinish();
        applyServerConfig(res.config);
        try {
          const topicsRes = await api.getTopics();
          const nextTopics = (topicsRes.topics || []).slice(0, 3).map((t: any) => String(t?.title ?? t ?? '')).filter(Boolean);
          if (nextTopics.length > 0) {
            await Promise.race([
              api.previewBatch(nextTopics),
              new Promise((resolve) => setTimeout(resolve, 3500)),
            ]);
          }
        } catch {
          // best-effort
        }
        window.clearInterval(progTimer);
        setFinalizingProgress(100);
        completeSetup();
        addLogEntry({
          type: 'config_change',
          message: 'Setup wizard completed',
          details: `Business: ${businessConfig.businessName}`,
        });
        toast({
          title: "Setup complete!",
          description: "duro is ready to generate content.",
        });
      } catch (e) {
        toast({
          title: "Setup finish failed",
          description: String(e),
          variant: "destructive",
        });
      } finally {
        setIsFinalizing(false);
      }
    })();
  };
   
   const handleGoalToggle = (goal: ContentGoal) => {
     const current = businessConfig.contentGoals;
     const newGoals = current.includes(goal)
       ? current.filter(g => g !== goal)
       : [...current, goal];
     updateBusinessConfig({ contentGoals: newGoals });
   };
   
  const handleAddExcluded = async (raw: string) => {
    if (!raw.trim()) return;
    try {
      const cleaned = await cleanField('excluded_topic', raw.trim(), 120);
      if (cleaned === null) return;
      const newExcluded = [...businessConfig.excludedTopics, cleaned];
      updateBusinessConfig({ excludedTopics: newExcluded });
    } catch {
      // ignore
    }
  };
   
  const renderStepContent = () => {
     switch (currentStep.id) {
       case 'shopify':
         return (
           <div className="relative text-center space-y-6">
             {shopifyConnected && billing.required && !devMode.bypassBilling && (
               <div className="mx-auto max-w-md rounded-md border-2 border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
                 Payment required. Start your trial in the paywall screen or enable DEV MODE below.
               </div>
             )}
             <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto">
               <Store className="w-8 h-8 text-brand" />
             </div>
             <div>
               <h2 className="text-xl font-semibold mb-2">Connect Your Shopify Store</h2>
               <p className="text-muted-foreground">
                 We'll use your store data to create relevant, personalized content.
               </p>
             </div>
             <div className="max-w-sm mx-auto text-left space-y-2">
               <div className="flex items-center justify-between">
                 <Label htmlFor="shop-domain">Shop domain</Label>
                 {shopifyConnected && (
                   <button
                     type="button"
                     onClick={async () => {
                       try {
                         await api.disconnectShopify();
                         resetAllLocal();
                         setShopifyConnected(false);
                         setStep(0);
                         setWizardStep(0);
                         setForceLoginNext(true);
                       } catch {
                         // best effort
                       }
                     }}
                     className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
                     aria-label="Disconnect"
                   >
                     Disconnect
                   </button>
                 )}
               </div>
              <Input
                id="shop-domain"
                placeholder="your-store.myshopify.com"
                value={shopDomain}
                onChange={(e) => setShopDomainInput(e.target.value)}
                onBlur={async () => {
                  if (!shopDomain.trim()) return;
                  try {
                    const cleaned = await api.cleanInput('shop_domain', shopDomain, 200);
                    if (cleaned.valid) setShopDomainInput(normalizeShopDomain(cleaned.cleaned));
                  } catch {
                    // ignore
                  }
                }}
              />
             </div>

             <Button 
               size="lg" 
               onClick={handleNext}
               disabled={isLoading}
               className="w-full max-w-xs"
             >
               {isLoading ? (
                 <>
                   <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                   Connecting...
                 </>
               ) : shopifyConnected ? (
                 <>
                   Shopify Connected
                   <ArrowRight className="w-4 h-4 ml-2" />
                 </>
               ) : (
                 <>
                   Connect Shopify
                   <ArrowRight className="w-4 h-4 ml-2" />
                 </>
               )}
             </Button>

             <div className="mx-auto mt-6 max-w-md rounded-lg border-2 border-destructive bg-destructive/5 p-4 text-left">
               <p className="text-xs font-semibold uppercase text-destructive">DEV MODE (REMOVE BEFORE LAUNCH)</p>
               <div className="mt-3 space-y-3">
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
               </div>
             </div>
           </div>
         );
         
       case 'autofill':
         return (
           <div className="space-y-6">
             <div className="text-center">
               <h2 className="text-xl font-semibold mb-2">How would you like to set up?</h2>
               <p className="text-muted-foreground">
                 We can automatically analyze your store or you can enter details manually.
               </p>
             </div>
             <div className="grid gap-3">
               <button
                 onClick={() => setAutofillChoice('auto')}
                 className={`flex items-start gap-4 p-4 rounded-lg border text-left transition-all ${
                   autofillChoice === 'auto'
                     ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                     : 'border-border hover:border-primary/50'
                 }`}
               >
                 <div className="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
                   <Wand2 className="w-5 h-5 text-brand" />
                 </div>
                 <div>
                   <p className="font-medium">Autofill for me</p>
                   <p className="text-sm text-muted-foreground">
                     We'll analyze your Shopify store and pre-fill everything
                   </p>
                 </div>
               </button>
               
               <button
                 onClick={() => setAutofillChoice('manual')}
                 className={`flex items-start gap-4 p-4 rounded-lg border text-left transition-all ${
                   autofillChoice === 'manual'
                     ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                     : 'border-border hover:border-primary/50'
                 }`}
               >
                 <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                   <Building2 className="w-5 h-5 text-muted-foreground" />
                 </div>
                 <div>
                   <p className="font-medium">I'll enter manually</p>
                   <p className="text-sm text-muted-foreground">
                     Fill in your business details step by step
                   </p>
                 </div>
               </button>
             </div>
           </div>
         );
         
       case 'loading':
         return (
           <div className="text-center space-y-6 py-8">
             <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto">
               <Loader2 className="w-8 h-8 text-brand animate-spin" />
             </div>
             <div>
               <h2 className="text-xl font-semibold mb-2">
                 {isFinalizing ? 'Finalizing setup...' : 'Analyzing Your Store'}
               </h2>
               <p className="text-muted-foreground">
                 {isFinalizing
                   ? 'Generating your first post previews'
                   : 'Pulling data and generating insights...'}
               </p>
             </div>
             <div className="max-w-xs mx-auto">
               <Progress value={isFinalizing ? finalizingProgress : loadingProgress} className="h-2" />
               <p className="text-sm text-muted-foreground mt-2">
                 {isFinalizing ? finalizingProgress : loadingProgress}%
               </p>
             </div>
           </div>
         );
         
       case 'business':
         return (
           <div className="space-y-6">
             <div className="text-center">
               <h2 className="text-xl font-semibold mb-2">What's your business name?</h2>
               <p className="text-muted-foreground">
                 This will be used in your content
               </p>
             </div>
             <div className="max-w-md mx-auto">
              <Input
                value={businessConfig.businessName}
                onChange={(e) => updateBusinessConfig({ businessName: e.target.value })}
                onBlur={async () => {
                  const cleaned = await api.cleanInput('business_name', businessConfig.businessName, 200);
                  if (cleaned.valid) updateBusinessConfig({ businessName: cleaned.cleaned });
                }}
                placeholder="Enter your business name"
                className="text-center text-lg h-12"
                autoFocus
              />
             </div>
           </div>
         );
         
       case 'industry':
         return (
           <div className="space-y-6">
             <div className="text-center">
               <h2 className="text-xl font-semibold mb-2">What industry are you in?</h2>
               <p className="text-muted-foreground">
                 This helps us create relevant content
               </p>
             </div>
             <div className="max-w-md mx-auto">
              <Input
                value={businessConfig.industry}
                onChange={(e) => updateBusinessConfig({ industry: e.target.value })}
                onBlur={async () => {
                  const cleaned = await api.cleanInput('industry', businessConfig.industry, 200);
                  if (cleaned.valid) updateBusinessConfig({ industry: cleaned.cleaned });
                }}
                placeholder="e.g., Fashion, Electronics, Home & Garden"
                className="text-center text-lg h-12"
                autoFocus
              />
             </div>
           </div>
         );
         
       case 'products':
         return (
           <div className="space-y-6">
             <div className="text-center">
               <h2 className="text-xl font-semibold mb-2">What do you sell?</h2>
               <p className="text-muted-foreground">
                 Add your main products or services
               </p>
             </div>
            <div className="max-w-lg mx-auto">
              <TagInput
                tags={productTags}
                onAdd={async (value) => {
                  const cleaned = cleanProductTagLocal(value);
                  if (!cleaned) {
                    toast({
                      title: "Invalid product",
                      description: "Please enter a more specific product name.",
                      variant: "destructive",
                    });
                    return;
                  }
                  setProductTags(normalizeProductTags([...productTags, cleaned]));
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
          </div>
        );
         
       case 'excluded':
         return (
           <div className="space-y-6">
             <div className="text-center">
               <h2 className="text-xl font-semibold mb-2">Any topics to avoid?</h2>
               <p className="text-muted-foreground">
                 Words or topics the AI should never mention (optional)
               </p>
             </div>
            <div className="max-w-md mx-auto">
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
              />
            </div>
          </div>
        );

       case 'customer':
         return (
           <div className="space-y-6">
             <div className="text-center">
               <h2 className="text-xl font-semibold mb-2">Who is your target customer?</h2>
               <p className="text-muted-foreground">
                 Describe your ideal customer
               </p>
             </div>
            <div className="max-w-lg mx-auto">
              <Textarea
                value={businessConfig.targetCustomer}
                onChange={(e) => updateBusinessConfig({ targetCustomer: e.target.value })}
                onBlur={async () => {
                  const cleaned = await api.cleanInput('target_customer', businessConfig.targetCustomer, 300);
                  if (cleaned.valid) updateBusinessConfig({ targetCustomer: cleaned.cleaned });
                }}
                placeholder="e.g., Tech-savvy professionals aged 25-45 who value quality..."
                rows={4}
                autoFocus
              />
              {isSuggestingCustomer && (
                <p className="text-xs text-muted-foreground mt-2">
                  Analyzing your store to suggest a target customer...
                </p>
              )}
            </div>
          </div>
        );
         
      case 'goals':
        return (
          <div className="space-y-6">
             <div className="text-center">
               <h2 className="text-xl font-semibold mb-2">What are your content goals?</h2>
               <p className="text-muted-foreground">
                 Select one or more goals
               </p>
             </div>
             <div className="max-w-md mx-auto grid gap-3">
               {[
                 { value: 'traffic' as ContentGoal, label: 'Drive Traffic', desc: 'Attract more visitors to your store' },
                 { value: 'sales' as ContentGoal, label: 'Increase Sales', desc: 'Convert visitors into customers' },
                 { value: 'authority' as ContentGoal, label: 'Build Authority', desc: 'Establish expertise in your niche' },
               ].map(({ value, label, desc }) => (
                 <button
                   key={value}
                   onClick={() => handleGoalToggle(value)}
                   className={`flex items-center gap-4 p-4 rounded-lg border text-left transition-all ${
                     businessConfig.contentGoals.includes(value)
                       ? 'border-primary bg-primary/5'
                       : 'border-border hover:border-primary/50'
                   }`}
                 >
                   <Checkbox
                     checked={businessConfig.contentGoals.includes(value)}
                     className="pointer-events-none"
                   />
                   <div>
                     <p className="font-medium">{label}</p>
                     <p className="text-sm text-muted-foreground">{desc}</p>
                   </div>
                 </button>
               ))}
             </div>
          </div>
        );
      case 'intent':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">Default Content Intent</h2>
              <p className="text-muted-foreground">
                Choose the intent that best matches your primary content style. You can still set intent per topic later.
              </p>
            </div>
            <div className="grid gap-3">
              {[
                { value: 'informational', label: 'Informational', description: 'Educational, helpful, and explanatory posts.' },
                { value: 'commercial', label: 'Commercial', description: 'Comparison, evaluation, and consideration content.' },
                { value: 'transactional', label: 'Transactional', description: 'Purchase-focused, conversion-friendly content.' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setIntentChoice(opt.value as ContentIntent)}
                  className={`flex items-start gap-4 p-4 rounded-lg border text-left transition-all ${
                    intentChoice === opt.value
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    intentChoice === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    <Target className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-medium">{opt.label}</p>
                    <p className="text-sm text-muted-foreground">{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
         
       case 'tone':
         return (
           <div className="space-y-6">
             <div className="text-center">
               <h2 className="text-xl font-semibold mb-2">What tone should we use?</h2>
               <p className="text-muted-foreground">
                 This sets the voice for all your content
               </p>
             </div>
             <div className="max-w-md mx-auto grid gap-3">
               {TONE_OPTIONS.map(({ value, label, description }) => (
                 <button
                   key={value}
                   onClick={() => updateBusinessConfig({ tone: value })}
                   className={`flex items-start gap-4 p-4 rounded-lg border text-left transition-all ${
                     businessConfig.tone === value
                       ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                       : 'border-border hover:border-primary/50'
                   }`}
                 >
                   <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex-shrink-0 ${
                     businessConfig.tone === value
                       ? 'border-primary bg-primary'
                       : 'border-muted-foreground'
                   }`} />
                   <div>
                     <p className="font-medium">{label}</p>
                     <p className="text-sm text-muted-foreground">{description}</p>
                   </div>
                 </button>
               ))}
             </div>
           </div>
         );
         
       case 'review':
         return (
           <div className="space-y-6">
             <div className="text-center">
               <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
                 <CheckCircle2 className="w-8 h-8 text-success" />
               </div>
               <h2 className="text-xl font-semibold mb-2">Review Your Setup</h2>
               <p className="text-muted-foreground">
                 Make sure everything looks correct
               </p>
             </div>
             <div className="max-w-lg mx-auto space-y-4">
               <div className="panel">
                 <div className="divide-y divide-border">
                   <div className="px-4 py-3 flex justify-between">
                     <span className="text-sm text-muted-foreground">Business</span>
                     <span className="text-sm font-medium truncate max-w-[200px]">
                       {businessConfig.businessName}
                     </span>
                   </div>
                   <div className="px-4 py-3 flex justify-between">
                     <span className="text-sm text-muted-foreground">Industry</span>
                     <span className="text-sm font-medium truncate max-w-[200px]">
                       {businessConfig.industry}
                     </span>
                   </div>
                   <div className="px-4 py-3 flex justify-between">
                     <span className="text-sm text-muted-foreground">Goals</span>
                     <span className="text-sm font-medium">
                       {businessConfig.contentGoals.join(', ')}
                     </span>
                   </div>
                   <div className="px-4 py-3 flex justify-between">
                     <span className="text-sm text-muted-foreground">Tone</span>
                     <span className="text-sm font-medium capitalize">
                       {businessConfig.tone}
                     </span>
                   </div>
                   {businessConfig.excludedTopics.length > 0 && (
                     <div className="px-4 py-3 flex justify-between">
                       <span className="text-sm text-muted-foreground">Excluded</span>
                       <span className="text-sm font-medium">
                         {businessConfig.excludedTopics.length} topic(s)
                       </span>
                     </div>
                   )}
                 </div>
               </div>
             </div>
           </div>
         );
         
       default:
         return null;
     }
   };
   
  return (
    <Dialog open={open}>
      <DialogContent 
        className="max-w-xl p-0 gap-0 overflow-hidden [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Setup Wizard</DialogTitle>
        <DialogDescription className="sr-only">
          Connect Shopify and configure business details to start generating posts.
        </DialogDescription>
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand">
            <Zap className="w-4 h-4 text-brand-foreground" />
          </div>
           <div className="flex-1">
             <p className="text-sm font-medium">Setup Wizard</p>
             <p className="text-xs text-muted-foreground">
               Step {step + 1} of {WIZARD_STEPS.length}
             </p>
           </div>
           <div className="flex items-center gap-2">
             {WIZARD_STEPS.map((s, i) => (
               <div
                 key={s.id}
                 className={`w-2 h-2 rounded-full transition-colors ${
                   i < step ? 'bg-success' :
                   i === step ? 'bg-primary' : 'bg-muted'
                 }`}
               />
             ))}
           </div>
         </div>
         
         {/* Content */}
         <div className="p-6 min-h-[400px] flex items-center justify-center">
           <AnimatePresence mode="wait">
             <motion.div
               key={step}
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               exit={{ opacity: 0, x: -20 }}
               transition={{ duration: 0.2 }}
               className="w-full"
             >
               {renderStepContent()}
             </motion.div>
           </AnimatePresence>
         </div>
         
         {/* Footer */}
         {currentStep.id !== 'shopify' && currentStep.id !== 'loading' && (
           <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30">
             <Button
               variant="ghost"
               onClick={handleBack}
               disabled={step === 0}
             >
               <ArrowLeft className="w-4 h-4 mr-2" />
               Back
             </Button>
             
            <Button
              onClick={handleNext}
              disabled={!canProceed() || isSavingStep}
            >
              {isSavingStep ? 'Saving...' : (currentStep.id === 'review' ? 'Complete Setup' : 'Continue')}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
           </div>
         )}
       </DialogContent>
     </Dialog>
   );
 }

