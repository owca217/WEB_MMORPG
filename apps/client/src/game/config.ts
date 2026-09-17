import Phaser from "phaser";
import { BootScene } from "../scenes/BootScene";
import { LoginScene } from "../scenes/LoginScene";
import { WorldScene } from "../scenes/WorldScene";

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#111318",
  scene: [BootScene, LoginScene, WorldScene],
  physics: {
    default: "arcade",
    arcade: { debug: false }
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: "100%",
    height: "100%"
  },
  input: {
    activePointers: 3
  },
  render: {
    antialias: true,
    pixelArt: false
  }
};
