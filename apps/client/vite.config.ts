import { defineConfig } from "vite";

export function resolveViteBasePath(
  configuredBasePath: string | undefined
): string {
  return configuredBasePath ?? "/WEB_MMORPG/";
}

export default defineConfig({
  base: resolveViteBasePath(process.env.VITE_BASE_PATH)
});
