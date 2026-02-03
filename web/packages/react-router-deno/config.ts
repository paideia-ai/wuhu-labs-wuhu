import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";

import { resolveDenoImports } from "./resolver/plugin.ts";

export function reactRouterDev(): UserConfig {
  return defineConfig({
    plugins: [
      resolveDenoImports(),
      reactRouter(),
    ],
  });
}

export function reactRouterBuild(): UserConfig {
  return defineConfig({
    plugins: [
      resolveDenoImports(),
      reactRouter(),
    ],
    ssr: {
      target: "webworker",
    },
    build: {
      target: "esnext",
    },
  });
}
