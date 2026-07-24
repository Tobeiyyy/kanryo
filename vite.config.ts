import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      manifest: {
        name: "Kanryo",
        short_name: "Kanryo",
        display: "standalone",
        background_color: "#f7f7f5",
        theme_color: "#f7f7f5",
        icons: [
          { src: "/icons/icon-192-v2.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512-v2.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
});
