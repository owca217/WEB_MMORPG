import Phaser from "phaser";

function color(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

export function createHairGraphic(
  scene: Phaser.Scene,
  style: string,
  hairColor: string,
  scale: number
): Phaser.GameObjects.Container {
  const root = scene.add.container();
  const fill = color(hairColor);

  if (style === "hair-01") {
    root.add(scene.add.arc(0, -14, 16 * scale, 180, 360, false, fill));
  } else if (style === "hair-02") {
    root.add(scene.add.rectangle(0, -20, 28 * scale, 9 * scale, fill));
  } else if (style === "hair-03") {
    root.add([
      scene.add.ellipse(-10 * scale, -12, 10 * scale, 24 * scale, fill),
      scene.add.ellipse(10 * scale, -12, 10 * scale, 24 * scale, fill)
    ]);
  } else if (style === "hair-04") {
    root.add([
      scene.add.arc(0, -15, 17 * scale, 180, 360, false, fill),
      scene.add.rectangle(-13 * scale, -7, 6 * scale, 20 * scale, fill),
      scene.add.rectangle(13 * scale, -7, 6 * scale, 20 * scale, fill)
    ]);
  } else {
    root.add([
      scene.add.arc(0, -14, 16 * scale, 180, 360, false, fill),
      scene.add.triangle(
        0,
        -25,
        -8 * scale,
        8 * scale,
        0,
        -8 * scale,
        8 * scale,
        8 * scale,
        fill
      )
    ]);
  }

  return root;
}

export function createFacialHairGraphic(
  scene: Phaser.Scene,
  style: string,
  hairColor: string,
  scale: number
): Phaser.GameObjects.Container {
  const root = scene.add.container();
  if (style === "facial-hair-none") return root;
  const fill = color(hairColor);

  if (style === "facial-hair-01") {
    root.add(scene.add.rectangle(0, 1, 14 * scale, 3 * scale, fill));
  } else {
    root.add([
      scene.add.rectangle(0, 1, 14 * scale, 3 * scale, fill),
      scene.add.triangle(
        0,
        8,
        -8 * scale,
        0,
        8 * scale,
        0,
        0,
        10 * scale,
        fill
      )
    ]);
  }
  return root;
}

export function createMarkingGraphic(
  scene: Phaser.Scene,
  marking: string,
  scale: number
): Phaser.GameObjects.Container {
  const root = scene.add.container();

  if (marking === "scar-01") {
    root.add(
      scene.add.rectangle(7 * scale, -8, 2, 12 * scale, 0x7d4438).setRotation(0.45)
    );
  } else if (marking === "scar-02") {
    root.add(
      scene.add.rectangle(-7 * scale, -4, 2, 13 * scale, 0x7d4438).setRotation(-0.45)
    );
  } else if (marking === "tattoo-01") {
    root.add(scene.add.circle(7 * scale, -5, 3 * scale, 0x38475c));
  }

  return root;
}
