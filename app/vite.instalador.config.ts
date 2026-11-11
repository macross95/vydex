// Interfaz del instalador de Vydex: misma base (React + Tailwind + diseño) que el programa,
// compilada aparte en dist-instalador/ para empaquetarla en app-instalador.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __VERSION__: JSON.stringify(version) },
  clearScreen: false,
  build: {
    outDir: "dist-instalador",
    emptyOutDir: true,
    rollupOptions: { input: "instalador.html" },
  },
  server: { port: 1431, strictPort: true },
  preview: { port: 4174, strictPort: true },
});
