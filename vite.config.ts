import { defineConfig } from "vite";

export default defineConfig({
  base: "/wooden-pose-walk/",
  server: {
    host: true,
    port: 43217,
  },
  preview: {
    host: true,
    port: 43217,
  },
});
