@echo off

wt -w 0 ^
  new-tab --title "Node App" cmd /k "cd C:\Users\Alexander\shopify-robot && node index.js" ^
  ; new-tab --title "Cloudflare Tunnel" cmd /k "cloudflared tunnel run cartwheel"


