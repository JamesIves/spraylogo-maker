/**
 * Gap kept between a tooltip and the edge of the screen, in pixels.
 */
const SCREEN_MARGIN = 8;

/**
 * Nudges an open tooltip sideways so it stays on screen, which matters on phones
 * where a help button can sit near the right edge.
 */
function keepOnScreen(text: HTMLElement): void {
  text.style.removeProperty('left');
  const { left, right } = text.getBoundingClientRect();
  // Not window.innerWidth: on phones it grows to fit anything sticking out, this included.
  const overflow = right - (document.documentElement.clientWidth - SCREEN_MARGIN);
  if (overflow > 0) {
    text.style.left = `${-Math.min(overflow, left - SCREEN_MARGIN)}px`;
  }
}

/**
 * Turns every `button[data-tip]` into a help button with an accessible tooltip.
 * It opens on hover, focus or tap, stays open while the pointer is over it, and
 * closes on Escape or a tap elsewhere.
 */
export function setupTooltips(root: ParentNode): void {
  const wrappers: HTMLElement[] = [];

  /**
   * Closes every open tooltip.
   */
  const closeAll = (): void => {
    for (const wrapper of wrappers) delete wrapper.dataset.open;
  };

  root
    .querySelectorAll<HTMLButtonElement>('button[data-tip]')
    .forEach((button, index) => {
      const wrapper = document.createElement('span');
      const text = document.createElement('span');
      wrapper.className = 'tip-wrap';
      text.className = 'tip__text';
      text.id = `tip-${index + 1}`;
      text.setAttribute('role', 'tooltip');
      text.textContent = button.dataset.tip ?? '';
      button.setAttribute('aria-describedby', text.id);
      button.replaceWith(wrapper);
      wrapper.append(button, text);
      wrappers.push(wrapper);

      /**
       * Shows this tooltip, closing any other, and keeps it on screen.
       */
      const open = (): void => {
        closeAll();
        wrapper.dataset.open = '';
        keepOnScreen(text);
      };

      /**
       * Hides this tooltip.
       */
      const close = (): void => {
        delete wrapper.dataset.open;
      };

      wrapper.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') open();
      });
      wrapper.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'mouse' && document.activeElement !== button) close();
      });
      button.addEventListener('focus', open);
      button.addEventListener('blur', close);
      // Some mobile browsers don't focus buttons when tapped, so open on click too.
      button.addEventListener('click', open);
    });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null;
    if (!target?.closest('.tip-wrap')) closeAll();
  });
}
