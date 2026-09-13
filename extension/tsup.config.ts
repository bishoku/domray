import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Background Service Worker — bundled as a single self-contained script
    entry: { "background/index": "src/background/index.ts" },
    outDir: "dist",
    format: ["esm"],        // MV3 service_worker supports ES modules
    target: "es2022",
    bundle: true,
    minify: false,
    sourcemap: true,
    platform: "browser",
    outExtension: () => ({ js: ".js" }),
  },
  {
    // Popup script — plain IIFE (no module wrapper needed for popup pages)
    entry: { "popup/popup": "src/popup/popup.ts" },
    outDir: "dist",
    format: ["iife"],
    target: "es2022",
    bundle: true,
    minify: false,
    sourcemap: true,
    platform: "browser",
    outExtension: () => ({ js: ".js" }),
  },
  {
    // Side Panel dashboard script — IIFE
    entry: { "sidepanel/sidepanel": "src/sidepanel/sidepanel.ts" },
    outDir: "dist",
    format: ["iife"],
    target: "es2022",
    bundle: true,
    minify: false,
    sourcemap: true,
    platform: "browser",
    outExtension: () => ({ js: ".js" }),
  },
  {
    // Content script tracker — plain IIFE
    entry: { "content/tracker": "src/content/tracker.ts" },
    outDir: "dist",
    format: ["iife"],
    target: "es2022",
    bundle: true,
    minify: false,
    sourcemap: true,
    platform: "browser",
    outExtension: () => ({ js: ".js" }),
  },
]);
