import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  optimizeDeps: { exclude: ["rioterm"] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const modulePath = id.replaceAll("\\", "/");
          if (modulePath.includes("/node_modules/react/") || modulePath.includes("/node_modules/react-dom/") || modulePath.includes("/node_modules/scheduler/")) return "react-vendor";
        },
      },
    },
  },
});
