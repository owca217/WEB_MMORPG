import Phaser from "phaser";
import { gameConfig } from "./config";

export class GameApp {
  readonly game: Phaser.Game;

  constructor() {
    this.game = new Phaser.Game(gameConfig);
  }

  destroy(): void {
    this.game.destroy(true);
  }
}
