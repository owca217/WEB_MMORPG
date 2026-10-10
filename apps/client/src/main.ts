import "./style.css";
import "./theme/classic-rpg.css";
import { GameApp } from "./game/GameApp";
import { getGitHubPagesRedirectUrl } from "./hosting";

const redirectUrl = getGitHubPagesRedirectUrl(window.location.href);
if (redirectUrl) {
  window.location.replace(redirectUrl);
} else {
  new GameApp();
}
