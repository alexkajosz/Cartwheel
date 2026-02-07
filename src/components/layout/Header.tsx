import { useEffect, useState } from 'react';
import { Bell, HelpCircle, Moon, Store, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
 
 interface HeaderProps {
   title: string;
   subtitle?: string;
 }
 
export function Header({ title, subtitle }: HeaderProps) {
  const { businessConfig, shopifyConnected, setShopifyConnected, resetAllLocal } = useAppStore();
  const { toast } = useToast();
  const [connectOpen, setConnectOpen] = useState(false);
  const [shopDomain, setShopDomain] = useState('');
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const enabled = saved ? saved === 'dark' : prefersDark;
    setIsDark(enabled);
    document.documentElement.classList.toggle('dark', enabled);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const normalizeShopDomain = (value: string) => {
    let cleaned = String(value || '').trim();
    if (!cleaned) return '';
    cleaned = cleaned.replace(/^https?:\/\//i, '');
    cleaned = cleaned.replace(/\/.*$/, '');
    if (cleaned.includes('?')) cleaned = cleaned.split('?')[0].trim();
    return cleaned.trim();
  };
  
  return (
    <>
      <header className="flex items-center justify-between px-8 py-5 border-b border-border bg-card">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => setConnectOpen(true)}
            className="flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <span className={`w-2 h-2 rounded-full ${shopifyConnected ? 'bg-success' : 'bg-muted-foreground'}`} />
            <Store className="w-3.5 h-3.5" />
            <span className="max-w-[160px] truncate">
              {businessConfig.businessName || 'Shopify store'}
            </span>
          </Button>

          <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={toggleTheme}>
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </Button>
          
          <Button variant="ghost" size="icon" className="text-muted-foreground">
            <HelpCircle className="w-5 h-5" />
          </Button>
          
          <Button variant="ghost" size="icon" className="text-muted-foreground relative">
            <Bell className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Shopify Connection</DialogTitle>
          </DialogHeader>
          {shopifyConnected ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                You are connected to Shopify. You can disconnect and reconnect at any time.
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await api.disconnectShopify();
                    resetAllLocal();
                    setShopifyConnected(false);
                    setConnectOpen(false);
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
                }}
                className="w-full"
              >
                Disconnect Shopify
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="shop-domain" className="text-sm font-medium">
                  Shop domain
                </label>
                <Input
                  id="shop-domain"
                  placeholder="your-store.myshopify.com"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  onBlur={async () => {
                    if (!shopDomain.trim()) return;
                    try {
                      const cleaned = await api.cleanInput('shop_domain', shopDomain, 200);
                      if (cleaned.valid) setShopDomain(cleaned.cleaned);
                    } catch {
                      // ignore
                    }
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
        </DialogContent>
      </Dialog>
    </>
  );
}
