import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Library build for @openturn/inspector-ui.
// Uses Vite (not plain tsc) so that `?inline` CSS imports in src/devtools-styles.ts
// are resolved into string constants at build time. Without this the published
// package would carry broken `import x from "...css?inline"` calls that only
// work for downstream Vite users.
export default defineConfig({
  plugins: [
    tailwindcss(),
    dts({
      tsconfigPath: "./tsconfig.build.json",
      rollupTypes: false,
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve(__dirname, "src/index.tsx"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      // Don't bundle peer/runtime deps — let consumers resolve them.
      external: [
        "react",
        "react/jsx-runtime",
        "react-dom",
        /^@openturn\//,
        /^@xyflow\//,
        /^@radix-ui\//,
        "radix-ui",
        "lucide-react",
        "shiki",
        "dagre",
        "clsx",
        "tailwind-merge",
        "class-variance-authority",
        "re-resizable",
      ],
    },
  },
});
