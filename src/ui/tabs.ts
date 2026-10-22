/**
 * Every tab in a tab list, shown or not.
 */
function allTabs(tablist: HTMLElement): HTMLButtonElement[] {
  return [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

/**
 * Selects a tab and shows its panel, hiding the others.
 */
function selectTab(tablist: HTMLElement, tab: HTMLButtonElement): void {
  for (const other of allTabs(tablist)) {
    const selected = other === tab;
    other.setAttribute('aria-selected', String(selected));
    other.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(other.getAttribute('aria-controls') ?? '');
    if (panel) panel.hidden = !selected;
  }
}

/**
 * Wires up an ARIA tab list: clicking a tab or using the arrow, Home and End keys
 * shows the matching panel. Hidden tabs are skipped.
 */
export function setupTabs(tablist: HTMLElement): void {
  tablist.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (tab) selectTab(tablist, tab);
  });

  tablist.addEventListener('keydown', (event) => {
    const visible = allTabs(tablist).filter((tab) => !tab.hidden);
    const current = visible.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const targets: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: visible.length - 1,
    };
    if (!(event.key in targets)) return;
    event.preventDefault();
    const next = visible[(targets[event.key] + visible.length) % visible.length];
    selectTab(tablist, next);
    next.focus();
  });
}

/**
 * Shows or hides a tab, moving the selection to the first tab if the open one is
 * hidden.
 */
export function setTabVisible(tab: HTMLButtonElement, visible: boolean): void {
  tab.hidden = !visible;
  const tablist = tab.parentElement;
  if (!visible && tablist && tab.getAttribute('aria-selected') === 'true') {
    selectTab(tablist, allTabs(tablist)[0]);
  }
}
