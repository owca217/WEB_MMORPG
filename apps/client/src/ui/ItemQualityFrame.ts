import { getItemQualityDefinition, type ItemQuality } from "@web-mmorpg/shared";
import "./ItemQualityFrame.css";

interface QualityItem { quality?: ItemQuality; }

export function itemQualityText(item: QualityItem): string {
  return `Jakość: ${getItemQualityDefinition(item.quality).label}`;
}

export function applyItemQualityFrame<T extends HTMLElement>(icon: T, item?: QualityItem): T {
  if (!item) return icon;
  const quality = getItemQualityDefinition(item.quality);
  icon.classList.add("item-quality-frame");
  icon.dataset.itemQuality = quality.id;
  icon.style.setProperty("--item-quality-color", quality.color);
  icon.title = itemQualityText(item);
  icon.removeAttribute("aria-hidden");
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", icon.title);
  return icon;
}
