import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    allowedHosts: ["cartwheel.monroemushroom.shop"],
    proxy: {
      "/admin": { target: "http://localhost:3000", changeOrigin: true },
      "/post-seo": { target: "http://localhost:3000", changeOrigin: true },
      "/__routes": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
