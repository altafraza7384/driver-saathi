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
      },
    },
  },
}));
