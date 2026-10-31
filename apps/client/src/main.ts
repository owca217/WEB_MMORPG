import "./style.css";
import { GameApp } from "./game/GameApp";
import { getGitHubPagesRedirectUrl } from "./hosting";
import { initializeNativeClient } from "./native/nativeLifecycle";
import "./ui/gameTheme.css";
import "./ui/itemSlots.css";

const redirectUrl = getGitHubPagesRedirectUrl(window.location.href);
if (redirectUrl) {
  window.location.replace(redirectUrl);
} else {
  new GameApp();
  void initializeNativeClient()
    .then((cleanup) => window.addEventListener('pagehide', () => { void cleanup(); }, { once: true }))
    .catch((error: unknown) => console.warn('Native lifecycle could not be initialized', error));
}
