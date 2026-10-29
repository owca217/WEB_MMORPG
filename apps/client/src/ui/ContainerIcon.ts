import type { InventoryItem } from "@web-mmorpg/shared";

export function containerIcon(item?: InventoryItem): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "container-icon";
  icon.dataset.containerIcon = "";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "▣";

  if (item?.iconUrl) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = item.iconUrl;
    image.addEventListener("error", () => { icon.textContent = "▣"; }, { once: true });
    icon.replaceChildren(image);
  }
  return icon;
}
