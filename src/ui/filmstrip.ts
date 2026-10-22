import { SPRAY_FRAME_MS } from '../animation/frames';

/**
 * What the filmstrip shows.
 */
export interface FilmstripState {
  /**
   * One thumbnail per source frame.
   */
  thumbnails: HTMLCanvasElement[];
  /**
   * Source frames the spray currently uses, in playback order.
   */
  used: number[];
  /**
   * Source frames the user removed.
   */
  excluded: ReadonlySet<number>;
}

/**
 * Creates the button for one source frame.
 */
function frameButton(thumbnail: HTMLCanvasElement, frame: number): HTMLLIElement {
  const item = document.createElement('li');
  const button = document.createElement('button');
  const number = document.createElement('span');
  button.type = 'button';
  button.dataset.frame = String(frame);
  number.textContent = String(frame + 1);
  button.append(thumbnail, number);
  item.append(button);
  return item;
}

/**
 * Shows every source frame as a thumbnail, dimmed when unused and crossed out when
 * removed. Clicking a frame (handled by the caller) removes or restores it.
 */
export function renderFilmstrip(
  list: HTMLElement,
  note: HTMLElement,
  { thumbnails, used, excluded }: FilmstripState,
): void {
  if (list.children.length !== thumbnails.length) {
    list.replaceChildren(...thumbnails.map(frameButton));
  }
  const inUse = new Set(used);
  for (const button of list.querySelectorAll<HTMLButtonElement>('button[data-frame]')) {
    const frame = Number(button.dataset.frame);
    const removed = excluded.has(frame);
    button.classList.toggle('is-unused', !inUse.has(frame));
    button.classList.toggle('is-removed', removed);
    button.setAttribute('aria-pressed', String(!removed));
    button.title = removed ? `Put frame ${frame + 1} back` : `Remove frame ${frame + 1}`;
  }
  const seconds = ((used.length * SPRAY_FRAME_MS) / 1000).toFixed(1);
  note.textContent = `Using ${used.length} of ${thumbnails.length} frames, ${seconds} seconds per loop. Click a frame to remove it.`;
}
