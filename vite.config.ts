import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 43217,
  },
  preview: {
    host: true,
    port: 43217,
  },
});
