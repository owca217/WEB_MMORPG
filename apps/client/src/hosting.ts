const GITHUB_PAGES_APP_ORIGIN = "https://owca217.github.io";
const GITHUB_PAGES_APP_PATH = "/WEB_MMORPG";
const RENDER_APP_ORIGIN = "https://web-mmorpg-server.onrender.com";

export function resolveGameServerUrl(
  configuredUrl: string | undefined,
  isDevelopment: boolean
): string {
  return configuredUrl ?? (isDevelopment ? "http://localhost:3001" : "");
}

export function getGitHubPagesRedirectUrl(currentUrl: string): string | null {
  let pageUrl: URL;
  try {
    pageUrl = new URL(currentUrl);
  } catch {
    return null;
  }

  if (
    pageUrl.origin !== GITHUB_PAGES_APP_ORIGIN ||
    (pageUrl.pathname !== GITHUB_PAGES_APP_PATH &&
      pageUrl.pathname !== `${GITHUB_PAGES_APP_PATH}/`)
  ) {
    return null;
  }

  return `${RENDER_APP_ORIGIN}/${pageUrl.search}${pageUrl.hash}`;
}
