import { defineConfig } from "vite";

export function resolveViteBasePath(
  configuredBasePath: string | undefined
): string {
  return configuredBasePath ?? "/WEB_MMORPG/";
}

export default defineConfig(({ mode }) => ({
  base: resolveViteBasePath(process.env.VITE_BASE_PATH),
  ...(mode === "android" ? { build: { target: "chrome111" } } : {})
}));
