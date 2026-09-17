import Phaser from "phaser";
import { gameSocket } from "../net/GameSocket";

export class LoginScene extends Phaser.Scene {
  private form: HTMLFormElement | undefined;

  constructor() {
    super("LoginScene");
  }

  create(): void {
    const form = document.createElement("form");
    form.className = "login-panel";
    form.innerHTML = `
      <h1>WEB MMORPG</h1>
      <p>Enter the shared world</p>
      <input name="nickname" minlength="3" maxlength="20" autocomplete="nickname" placeholder="Nickname" required />
      <button type="submit">Join</button>
      <p class="form-error" data-error></p>
    `;
    document.body.appendChild(form);
    this.form = form;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorElement = form.querySelector<HTMLElement>("[data-error]");
      const data = new FormData(form);
      const nickname = String(data.get("nickname") ?? "");

      if (errorElement) errorElement.textContent = "Connecting...";

      try {
        const result = await gameSocket.login(nickname);
        if (!result.ok) {
          if (errorElement) errorElement.textContent = result.message;
          return;
        }

        form.remove();
        this.form = undefined;
        this.scene.start("WorldScene", { playerId: result.playerId });
      } catch {
        if (errorElement) {
          errorElement.textContent = "Could not connect to the game server.";
        }
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.form?.remove();
      this.form = undefined;
    });
  }
}
