import Phaser from "phaser";
import { gameSocket } from "../net/GameSocket";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create(): void {
    gameSocket.connect();
    this.scene.start("LoginScene");
  }
}
