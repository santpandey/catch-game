import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths: required for Chrome extension pages / static hosts
  base: "./",
  // Optimize asset handling
  build: {
    assetsInlineLimit: 0, // Don't inline assets, keep them as separate files
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          // Organize assets by type
          let extType = assetInfo.name.split(".").at(1);
          if (/png|jpe?g|svg|gif|tiff|bmp|ico|webp/i.test(extType)) {
            extType = "images";
          } else if (/glb|gltf/i.test(extType)) {
            extType = "models";
          }
          return `assets/${extType}/[name]-[hash][extname]`;
        },
      },
    },
  },
  // Enable WebP support
  assetsInclude: ["**/*.webp", "**/*.glb", "**/*.gltf"],
  // Optimize dependencies
  optimizeDeps: {
    include: ["three", "cannon-es"],
  },
  // Server configuration
  server: {
    port: 5173,
    open: true, // Auto-open browser
  },
});
