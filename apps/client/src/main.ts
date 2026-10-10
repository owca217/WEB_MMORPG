import "./style.css";
import { GameApp } from "./game/GameApp";
import { getGitHubPagesRedirectUrl } from "./hosting";

const redirectUrl = getGitHubPagesRedirectUrl(window.location.href);
if (redirectUrl) {
  window.location.replace(redirectUrl);
} else {
  new GameApp();
}
