import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Unique id per build; written to /version.json so running apps can detect new releases.
const BUILD_ID = Date.now().toString(36);
const versionFile = () => ({
  name: "version-file",
  generateBundle(this: any) {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ buildId: BUILD_ID }) });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  define: { __APP_BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), versionFile(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Inline tiny chunks (<3KB) into their parent to reduce chain depth
        experimentalMinChunkSize: 3000,
        // Split the big third-party stacks out of the entry chunk. Routes
        // are already lazy (see src/App.tsx), so the entry otherwise
        // carries every vendor lib the shell touches (~1.4 MB). As their
        // own chunks the vendors download in parallel and — more importantly
        // for repeat web loads — stay cached across app deploys, since
        // their content hashes only change when the dependency does.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/") ||
            id.includes("node_modules/react-router")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules/@firebase") || id.includes("node_modules/firebase/")) {
            return "vendor-firebase";
          }
          if (id.includes("node_modules/@supabase")) return "vendor-supabase";
          if (
            id.includes("node_modules/@radix-ui") ||
            id.includes("node_modules/lucide-react") ||
            id.includes("node_modules/date-fns") ||
            id.includes("node_modules/sonner")
          ) {
            return "vendor-ui";
          }
          if (id.includes("node_modules/framer-motion")) {
            return "vendor-motion";
          }
          if (
            id.includes("node_modules/@capacitor") ||
            id.includes("node_modules/@capawesome") ||
            id.includes("node_modules/@lovable.dev")
          ) {
            return "vendor-capacitor";
          }
          return undefined;
        },
      },
    },
  },
}));
