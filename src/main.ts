import './styles/main.css';

import { selectFrames } from './animation/frames';
import { SprayEncoder } from './encoder/encoder';
import { hasTransparency, type RGBAImage } from './image/image';
import { decodeFiles, decodeStill, type SourceMedia } from './input/decode';
import { SIZE_LIMITS, maxFrames } from './spray/budget';
import type { SprayResult } from './spray/settings';
import { resolveFormat } from './spray/source';
import { renderDetails, renderMeter, type MeterElements } from './ui/details';
import { download, sprayZip } from './ui/download';
import { renderFilmstrip } from './ui/filmstrip';
import {
  applyRecipe,
  readForm,
  setField,
  syncVisibility,
  updateFadeLevels,
  type FormState,
  type Recipe,
  type SourceInfo,
} from './ui/form';
import { Preview, previewTexture } from './ui/preview';
import { setTabVisible, setupTabs } from './ui/tabs';
import { setupTooltips } from './ui/tooltips';
import { createThumbnail } from './ui/thumbnails';
import { createSprayVmt, sanitizeName } from './vtf/vmt';

/**
 * Looks up an element by id.
 */
function byId<ElementType extends HTMLElement = HTMLElement>(id: string): ElementType {
  return document.getElementById(id) as ElementType;
}

/**
 * The loaded source. Its pixels live in the worker; only these details stay here.
 */
interface LoadedSource extends Omit<SourceMedia, 'frames'> {
  /**
   * Whether any frame has transparent areas.
   */
  hasAlpha: boolean;
}

/**
 * Everything the page keeps track of between events.
 */
interface PageState {
  /**
   * The loaded source, if there is one.
   */
  source?: LoadedSource;
  /**
   * One thumbnail per source frame, for the filmstrip.
   */
  thumbnails: HTMLCanvasElement[];
  /**
   * Source frames the user removed.
   */
  excluded: Set<number>;
  /**
   * The most recently built spray.
   */
  result?: SprayResult;
  /**
   * Whether the user typed their own spray name, so loading files won't replace it.
   */
  nameEdited: boolean;
  /**
   * Timer for the next rebuild after a settings change.
   */
  encodeTimer?: number;
}

const form = byId<HTMLFormElement>('settings');
const statusLine = byId('status');
const busy = byId('busy');
const dropTarget = byId('drop-target');
const fileInput = byId<HTMLInputElement>('file-input');
const fadeInput = byId<HTMLInputElement>('fade-input');
// One row per far away image, in the same order as the worker's list.
const farList = byId<HTMLOListElement>('far-list');
const saveButton = byId<HTMLButtonElement>('download-spray');
const meterElements: MeterElements = {
  meter: byId('meter'),
  used: byId('meter-used'),
  fill: byId('meter-fill'),
  pixelLimit: byId('meter-pixel-limit'),
};

const state: PageState = {
  thumbnails: [],
  excluded: new Set(),
  nameEdited: false,
};

const encoder = new SprayEncoder((done, total) => {
  busy.textContent = total > 1 ? `Encoding frame ${done} of ${total}...` : 'Encoding...';
});

const preview = new Preview({
  canvas: byId('preview'),
  play: byId('play'),
  frameLabel: byId('frame-label'),
  mipSlider: byId('mip-level'),
  mipLabel: byId('mip-label'),
});

/**
 * Shows a message on the window's status line.
 */
function setStatus(message: string, tone: 'info' | 'error' = 'info'): void {
  statusLine.textContent = message;
  statusLine.dataset.tone = tone;
}

/**
 * Source frames the spray will use, after timing, range, removals and the limit.
 */
function currentFrames(formState: FormState): number[] {
  if (!state.source) return [];
  return selectFrames(state.source.durations, {
    ...formState.frames,
    excluded: state.excluded,
  });
}

/**
 * What the spray type presets need to know about the loaded source.
 */
function sourceInfo(): SourceInfo | undefined {
  const { source } = state;
  if (!source) return undefined;
  const { frames } = readForm(form);
  const all = { ...frames, start: 1, end: Infinity, excluded: state.excluded };
  return {
    width: source.width,
    height: source.height,
    hasAlpha: source.hasAlpha,
    frameCount: selectFrames(source.durations, all).length,
    hasFadeImage: farList.childElementCount > 0,
  };
}

/**
 * Picks a sensible spray type for what was just loaded.
 */
function guessRecipe(media: SourceMedia): Recipe {
  if (media.frames.length > 1) return 'animated';
  if (Math.max(media.width, media.height) <= 64) return 'pixel';
  return readForm(form).recipe === 'fading' ? 'fading' : 'still';
}

/**
 * Decodes opened files, hands their frames to the encoder and resets the controls
 * to suit them.
 */
async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  setStatus('Reading file...');
  try {
    const media = await decodeFiles(files, (message) => setStatus(message));
    const { frames, ...details } = media;
    state.thumbnails = frames.map((frame) => createThumbnail(frame));
    state.source = { ...details, hasAlpha: frames.some(hasTransparency) };
    state.excluded = new Set();
    state.result = undefined;
    encoder.setSources(frames);

    setField(form, 'start', '1');
    setField(form, 'end', String(frames.length));
    setField(form, 'step', '1');
    setField(form, 'reverse', false);
    setField(form, 'timing', 'spray');
    if (media.kind === 'wad') setField(form, 'engine', 'goldsrc');
    if (!state.nameEdited) setField(form, 'name', sanitizeName(files[0].name));

    byId('dropzone').hidden = true;
    byId('transport').hidden = false;
    byId('meter').hidden = false;
    const recipe = guessRecipe(media);
    applyRecipe(form, recipe, sourceInfo(), readForm(form).limit);
    const size = `${media.width} × ${media.height}`;
    const loaded =
      frames.length > 1
        ? `Loaded ${media.name}: ${frames.length} frames at ${size}. Choose which frames to use in the Animation tab.`
        : `Loaded ${media.name} (${size}).`;
    setStatus(
      state.source.hasAlpha
        ? `${loaded} It has transparency, so its edges are cleaned up automatically.`
        : loaded,
    );
    refresh();
  } catch (error) {
    setStatus((error as Error).message, 'error');
  }
}

/**
 * Builds the list row for a far away image: its thumbnail, the mip level it starts
 * at (one after the last image's, to begin with) and a remove button.
 */
function farImageRow(image: RGBAImage, name: string): HTMLLIElement {
  const levels = farList.querySelectorAll<HTMLSelectElement>('select[data-levels]');
  const last = levels[levels.length - 1] as HTMLSelectElement | undefined;
  // Rows added together don't have their options yet, so fall back to data-initial.
  const lastLevel = last ? Number(last.value || last.dataset.initial) : 0;
  const select = document.createElement('select');
  select.name = 'fadeImageLevel';
  select.dataset.levels = '';
  select.dataset.initial = String(lastLevel + 1);
  select.setAttribute('aria-label', `Start level for ${name}`);

  const cross = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  cross.setAttribute('viewBox', '0 0 16 16');
  cross.setAttribute('aria-hidden', 'true');
  cross.innerHTML =
    '<path d="M3.5 2.4 8 6.9l4.5-4.5 1.1 1.1L9.1 8l4.5 4.5-1.1 1.1L8 9.1l-4.5 4.5-1.1-1.1L6.9 8 2.4 3.5z" />';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button button--icon';
  remove.dataset.removeFar = '';
  remove.title = 'Remove';
  remove.setAttribute('aria-label', `Remove ${name}`);
  remove.append(cross);

  const row = document.createElement('li');
  row.className = 'far-image';
  row.title = name;
  row.append(createThumbnail(image, 40), select, remove);
  return row;
}

/**
 * Adds images a fading spray changes to at a distance, each starting a level
 * further away than the last.
 */
async function addFarImages(files: File[]): Promise<void> {
  try {
    for (const file of files) {
      const image = await decodeStill(file, 1024);
      // Draw the thumbnail before the pixels are handed to the worker.
      farList.append(farImageRow(image, file.name));
      encoder.addFarImage(image);
    }
    updateFadeLevels(form);
    setField(form, 'mipmaps', true);
    setField(form, 'fade', 'image');
    setStatus(
      files.length > 1
        ? `Added ${files.length} far away images.`
        : `Added ${files[0].name} as a far away image.`,
    );
  } catch (error) {
    setStatus((error as Error).message, 'error');
  }
  refresh();
}

/**
 * Removes a far away image's row, and the image itself from the worker.
 */
function removeFarImage(row: HTMLLIElement): void {
  encoder.removeFarImage([...farList.children].indexOf(row));
  row.remove();
  byId('choose-fade').focus();
  setStatus(`Removed ${row.title}.`);
  refresh();
}

/**
 * Updates the controls that depend on other settings, then rebuilds the spray
 * shortly after the last change.
 */
function refresh(): void {
  syncVisibility(form);
  const formState = readForm(form);
  const source = formState.settings.engine === 'source';
  const animated = (state.source?.durations.length ?? 0) > 1;

  setTabVisible(byId('tab-animation'), source && animated);
  setTabVisible(byId('tab-mipmaps'), source);
  setTabVisible(byId('tab-advanced'), source);
  saveButton.textContent = source ? 'Save VTF' : 'Save WAD';

  const filmstrip = byId('filmstrip-panel');
  filmstrip.hidden = !source || state.thumbnails.length < 2;
  if (!filmstrip.hidden) {
    renderFilmstrip(byId('filmstrip'), byId('filmstrip-note'), {
      thumbnails: state.thumbnails,
      used: currentFrames(formState),
      excluded: state.excluded,
    });
  }

  window.clearTimeout(state.encodeTimer);
  state.encodeTimer = window.setTimeout(() => void encode(), 120);
}

/**
 * Shows a newly built spray: the preview, the size meter and the file details.
 */
function showResult(result: SprayResult, formState: FormState): void {
  state.result = result;
  preview.show(previewTexture(result));
  updateMeter(formState);
  renderDetails(byId('facts'), result, formState.settings);
}

/**
 * Updates the size meter and the download buttons for the latest spray.
 */
function updateMeter(formState: FormState): void {
  const { result } = state;
  for (const id of ['download-spray', 'download-zip', 'download-vmt']) {
    byId<HTMLButtonElement>(id).disabled = !result;
  }
  if (!result) return;
  const exceeded = renderMeter(
    meterElements,
    result,
    formState.settings,
    formState.limit,
  );
  if (exceeded) {
    setStatus(
      `Too big: the game ignores sprays over ${exceeded}. Use fewer frames, a smaller size, or turn off mipmaps.`,
      'error',
    );
  } else if (statusLine.dataset.tone === 'error') {
    setStatus('');
  }
}

/**
 * Builds the spray with the current settings and shows the result.
 */
async function encode(): Promise<void> {
  if (!state.source) return;
  const formState = readForm(form);
  const { settings } = formState;
  const frames = currentFrames(formState);
  if (!frames.length) {
    setStatus(
      'No frames left to use. Widen the frame range or bring some back.',
      'error',
    );
    return;
  }
  if (settings.fade === 'image' && !farList.childElementCount) {
    setStatus('Add a far away image to change to, or pick another fade option.');
  }
  if (settings.engine === 'goldsrc' && frames.length > 1) {
    setStatus("GoldSrc sprays can't animate, so only the first frame is used.");
  }

  busy.hidden = false;
  try {
    const used = settings.engine === 'goldsrc' ? frames.slice(0, 1) : frames;
    const result = await encoder.encode(settings, used);
    if (result) showResult(result, formState);
  } catch (error) {
    setStatus((error as Error).message, 'error');
  } finally {
    busy.hidden = true;
  }
}

/**
 * Sets the frame limit to the most frames that fit under the size limit.
 */
function fitFramesToLimit(): void {
  const { settings, limit } = readForm(form);
  const format =
    state.result?.format ??
    resolveFormat(settings.format, state.source?.hasAlpha ?? false);
  const fits = maxFrames(settings, format, SIZE_LIMITS[limit]);
  if (fits < 1) {
    setStatus(
      'Even one frame is too big at this size. Pick a smaller size or format.',
      'error',
    );
    return;
  }
  setField(form, 'maxFrames', '0');
  const total = currentFrames(readForm(form)).length;
  setField(form, 'maxFrames', String(total > fits ? fits : 0));
  setStatus(
    total > fits ? `Kept ${fits} of ${total} frames.` : 'Every frame already fits.',
  );
  refresh();
}

/**
 * The spray name, cleaned up for use in file names.
 */
function downloadName(): string {
  return sanitizeName(readForm(form).name);
}

/**
 * Saves the spray: a named VTF for Source, or `tempdecal.wad` for GoldSrc.
 */
function saveSpray(): void {
  const { result } = state;
  if (!result) return;
  if (result.engine === 'goldsrc') {
    download(result.bytes, 'tempdecal.wad');
    setStatus(
      'Saved tempdecal.wad. Put it in the game folder (such as cstrike) and make it read-only.',
    );
  } else {
    download(result.bytes, `${downloadName()}.vtf`);
  }
}

form.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  const { limit, recipe } = readForm(form);
  if (target.name === 'name') {
    state.nameEdited = true;
    return;
  }
  if (target.name === 'limit') {
    updateMeter(readForm(form));
    return;
  }
  if (target.name === 'recipe' || target.name === 'engine') {
    applyRecipe(form, recipe, sourceInfo(), limit);
    if (recipe === 'fading' && !farList.childElementCount) {
      setStatus(
        'Fading out at a distance. Add far away images in the Mipmaps tab to change to different pictures instead.',
      );
    }
  }
  if (target.name === 'size') updateFadeLevels(form);
  refresh();
});
form.addEventListener('submit', (event) => event.preventDefault());

byId('choose-files').addEventListener('click', () => fileInput.click());
byId('replace').addEventListener('click', () => fileInput.click());
byId('choose-fade').addEventListener('click', () => fadeInput.click());
byId('fit-frames').addEventListener('click', fitFramesToLimit);

fileInput.addEventListener('change', () => {
  void loadFiles([...(fileInput.files ?? [])]);
  fileInput.value = '';
});
fadeInput.addEventListener('change', () => {
  const files = [...(fadeInput.files ?? [])];
  if (files.length) void addFarImages(files);
  fadeInput.value = '';
});
farList.addEventListener('click', (event) => {
  const row = (event.target as HTMLElement)
    .closest('button[data-remove-far]')
    ?.closest<HTMLLIElement>('li');
  if (row) removeFarImage(row);
});

dropTarget.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropTarget.classList.add('is-dragging');
});
dropTarget.addEventListener('dragleave', () =>
  dropTarget.classList.remove('is-dragging'),
);
dropTarget.addEventListener('drop', (event) => {
  event.preventDefault();
  dropTarget.classList.remove('is-dragging');
  void loadFiles([...(event.dataTransfer?.files ?? [])]);
});
window.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length && !(event.target instanceof HTMLInputElement)) void loadFiles(files);
});

byId('filmstrip').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-frame]',
  );
  if (!button) return;
  const frame = Number(button.dataset.frame);
  if (!state.excluded.delete(frame)) state.excluded.add(frame);
  refresh();
});

saveButton.addEventListener('click', saveSpray);
byId('download-vmt').addEventListener('click', () => {
  download(createSprayVmt(downloadName()), `${downloadName()}.vmt`, 'text/plain');
});
byId('download-zip').addEventListener('click', () => {
  if (!state.result) return;
  download(
    sprayZip(downloadName(), state.result.bytes),
    `${downloadName()}.zip`,
    'application/zip',
  );
});

setupTabs(form.querySelector<HTMLElement>('[role="tablist"]')!);
setupTooltips(document);
applyRecipe(form, 'still', undefined, 'modern');
syncVisibility(form);
