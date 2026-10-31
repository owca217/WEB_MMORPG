/** DOM windows own their close action, including confirmations and restoring focus. */
function visibleWindows(includeFloating = false): HTMLElement[] {
  const selector = ".game-panel, .dialogue-panel, [data-container-item-actions], [data-hud-menu]" + (includeFloating ? ", [data-floating-game-window]" : "");
  return [...document.querySelectorAll<HTMLElement>(selector)]
    .filter(panel => !panel.hidden && !panel.classList.contains("is-hidden") && getComputedStyle(panel).display !== "none");
}

export function isGameWindowOpen(): boolean { return visibleWindows().length > 0; }

function stackingOrder(panel: HTMLElement): number[] {
  const order: number[] = [];
  for (let element: HTMLElement | null = panel; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    const zIndex = Number.parseInt(style.zIndex);
    if (Number.isFinite(zIndex) && style.position !== "static") order.unshift(zIndex);
  }
  return order;
}

function foregroundGameWindow():HTMLElement|undefined {
  return visibleWindows(true).reverse().sort((a, b) => {
    // An inner panel cannot escape its widget's stacking context.
    const left = stackingOrder(a);
    const right = stackingOrder(b);
    for (let level = 0; level < Math.max(left.length, right.length); level++) {
      const difference = (right[level] ?? 0) - (left[level] ?? 0);
      if (difference) return difference;
    }
    return 0;
  })[0];
}

export function isForegroundGameWindow(panel:HTMLElement):boolean {return foregroundGameWindow()===panel;}

export function closeForegroundGamePanel(): boolean {
  const panel = foregroundGameWindow();
  const close = panel?.querySelector<HTMLButtonElement>("[data-close]");
  if (!close) return false;
  close.click();
  return true;
}
