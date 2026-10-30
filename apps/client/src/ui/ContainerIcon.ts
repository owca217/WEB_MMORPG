import { PERMANENT_BACKPACK_ICON_PATH, type InventoryItem } from "@web-mmorpg/shared";
import { applyItemQualityFrame } from "./ItemQualityFrame";

function backpackGlyph(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = `<path d="M11 8V6a5 5 0 0 1 10 0v2M7 15H4v10h3m18-10h3v10h-3"/>
    <rect x="7" y="8" width="18" height="22" rx="5"/>
    <path d="M8 14h16M13 14v4m6-4v4"/><rect x="11" y="21" width="10" height="6" rx="2"/>`;
  return svg;
}

export function containerIcon(item?: InventoryItem): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "container-icon";
  icon.dataset.containerIcon = "";
  icon.setAttribute("aria-hidden", "true");
  const showFallback = (): void => {
    icon.classList.add("container-icon--muted");
    icon.replaceChildren(backpackGlyph());
  };
  showFallback();

  const iconUrl=item?.permanentContainer ? `${import.meta.env.BASE_URL}${PERMANENT_BACKPACK_ICON_PATH}` : item?.iconUrl;
  if (iconUrl) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = iconUrl;
    image.addEventListener("error", showFallback, { once: true });
    icon.classList.remove("container-icon--muted");
    icon.replaceChildren(image);
  }
  return applyItemQualityFrame(icon, item);
}
