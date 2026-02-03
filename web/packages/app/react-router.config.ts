import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    v8_middleware: true,
    v8_viteEnvironmentApi: true,
  },
  serverModuleFormat: "esm",
  appDirectory: "app",
} satisfies Config;
