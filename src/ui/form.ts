import type { FrameOptions } from '../animation/frames';
import type { SharpenFilter } from '../image/filters';
import type { ResizeFilter } from '../image/resample';
import { SIZE_LIMITS, maxFrames, type SizeLimit } from '../spray/budget';
import type { Engine, FadeMode, FitMode, SpraySettings } from '../spray/settings';
import type { DxtQuality } from '../vtf/dxt';
import { ImageFormat, TextureFlag, mipCount, mipSize } from '../vtf/format';
import { fillSizeOptions, largestSquare } from './sizes';

/**
 * A starting point for each kind of spray.
 */
export type Recipe = 'still' | 'animated' | 'fading' | 'pixel';

/**
 * Everything the form holds, as typed values.
 */
export interface FormState {
  /**
   * The selected spray type.
   */
  recipe: Recipe;
  /**
   * The Source size limit to check against.
   */
  limit: SizeLimit;
  /**
   * The spray name typed in, before cleaning up.
   */
  name: string;
  /**
   * Settings for building the spray.
   */
  settings: SpraySettings;
  /**
   * Which animation frames to use (removed frames are tracked separately).
   */
  frames: Omit<FrameOptions, 'excluded'>;
}

/**
 * What the spray type presets need to know about the loaded source.
 */
export interface SourceInfo {
  /**
   * Source width in pixels.
   */
  width: number;
  /**
   * Source height in pixels.
   */
  height: number;
  /**
   * Frames the spray would use with the default timing.
   */
  frameCount: number;
  /**
   * Whether the source has transparent areas.
   */
  hasAlpha: boolean;
  /**
   * Whether a far away image has been chosen for fading.
   */
  hasFadeImage: boolean;
}

/**
 * Converts a `#rrggbb` colour to 0-1 RGB.
 */
function hexToRgb(hex: string): [number, number, number] {
  const [red, green, blue] = [1, 3, 5].map(
    (start) => parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  return [red, green, blue];
}

/**
 * Reads every control into typed settings.
 */
export function readForm(form: HTMLFormElement): FormState {
  const data = new FormData(form);

  /**
   * Reads a field as a string.
   */
  const text = (name: string): string => String(data.get(name) ?? '');

  /**
   * Reads a field as a number, or `fallback` when it's empty or invalid.
   */
  const numberOf = (name: string, fallback = 0): number => {
    const value = Number(data.get(name));
    return Number.isFinite(value) && data.get(name) !== '' ? value : fallback;
  };

  /**
   * True when a checkbox is ticked.
   */
  const checked = (name: string): boolean => data.has(name);

  const [width, height] = text('size').split('x').map(Number);
  const format = text('format');
  const engine = text('engine') as Engine;
  const mipmaps = engine === 'source' && checked('mipmaps');

  return {
    recipe: text('recipe') as Recipe,
    limit: text('limit') as SizeLimit,
    name: text('name'),
    settings: {
      engine,
      width,
      height,
      fit: text('fit') as FitMode,
      zoom: numberOf('zoom', 100) / 100,
      offsetX: numberOf('offsetX') / 100,
      offsetY: numberOf('offsetY') / 100,
      resizeFilter: text('resizeFilter') as ResizeFilter,
      format: format === 'auto' ? 'auto' : (Number(format) as ImageFormat),
      adjust: {
        brightness: numberOf('brightness') / 200,
        contrast: 1 + numberOf('contrast') / 100,
        saturation: 1 + numberOf('saturation') / 100,
      },
      imageSharpen: numberOf('imageSharpen') / 100,
      mipmaps,
      mipFilter: text('mipFilter') as ResizeFilter,
      mipSharpen: text('mipSharpen') as SharpenFilter,
      unsharp: {
        radius: numberOf('unsharpRadius', 2),
        amount: numberOf('unsharpAmount', 0.5),
        threshold: numberOf('unsharpThreshold'),
      },
      fade: mipmaps ? (text('fade') as FadeMode) : 'none',
      fadeLevel: numberOf('fadeLevel', 1),
      defringe: numberOf('defringe'),
      bleed: checked('bleed'),
      background: hexToRgb(text('background')),
      alphaThreshold: numberOf('alphaThreshold', 128),
      dither: checked('dither'),
      quality: (text('quality') || 'normal') as DxtQuality,
      flags: data
        .getAll('flag')
        .reduce((flags: number, value) => flags | Number(value), 0),
      version: numberOf('version', 2),
      thumbnail: checked('thumbnail'),
      reflectivity: checked('reflectivity'),
    },
    frames: {
      timing: text('timing') === 'all' ? 'all' : 'spray',
      start: numberOf('start', 1),
      end: numberOf('end', Infinity),
      step: Math.max(1, numberOf('step', 1)),
      reverse: checked('reverse'),
      maxFrames: Math.max(0, numberOf('maxFrames')),
    },
  };
}

/**
 * Sets a control by name, whether it's a radio group, checkbox or plain field.
 */
export function setField(
  form: HTMLFormElement,
  name: string,
  value: string | boolean,
): void {
  const field = form.elements.namedItem(name);
  if (field instanceof RadioNodeList) {
    field.value = String(value);
  } else if (field instanceof HTMLInputElement && field.type === 'checkbox') {
    field.checked = Boolean(value);
  } else if (field && 'value' in field) {
    field.value = String(value);
  }
}

/**
 * Ticks or unticks one texture flag checkbox.
 */
export function setFlag(form: HTMLFormElement, flag: number, on: boolean): void {
  const checkbox = form.querySelector<HTMLInputElement>(
    `input[name="flag"][value="${flag}"]`,
  );
  if (checkbox) checkbox.checked = on;
}

/**
 * The size picker.
 */
function sizeSelect(form: HTMLFormElement): HTMLSelectElement {
  return form.elements.namedItem('size') as HTMLSelectElement;
}

/**
 * The selected engine.
 */
function engineOf(form: HTMLFormElement): Engine {
  return (form.elements.namedItem('engine') as HTMLSelectElement).value as Engine;
}

/**
 * The smallest power of two that is at least `value`.
 */
function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

/**
 * Largest square Source size that holds every frame, or 64 if none do.
 */
function animatedSize(source: SourceInfo, limit: SizeLimit): number {
  const format = source.hasAlpha ? ImageFormat.DXT5 : ImageFormat.DXT1;
  const fits = [512, 256, 128, 64].find((size) => {
    const budget = {
      width: size,
      height: size,
      mipmaps: false,
      version: 2,
      thumbnail: true,
    };
    return maxFrames(budget, format, SIZE_LIMITS[limit]) >= source.frameCount;
  });
  return fits ?? 64;
}

/**
 * Smallest square that keeps every pixel of a small sprite: a power of two for
 * Source, a multiple of 16 for GoldSrc.
 */
function pixelArtSize(source: SourceInfo | undefined, engine: Engine): number {
  const side = Math.max(source?.width ?? 32, source?.height ?? 32);
  const largest = largestSquare(engine);
  const rounded = engine === 'goldsrc' ? Math.ceil(side / 16) * 16 : nextPowerOfTwo(side);
  return Math.min(largest, Math.max(16, rounded));
}

/**
 * Applies a starting point for each kind of spray: stills get mipmaps, animations
 * drop mipmaps to fit more frames, fades swap or clear the smaller mipmaps and
 * pixel art keeps hard edges. Any source with transparency also gets its cut-out
 * edges cleaned up. GoldSrc sprays can't animate or fade.
 */
export function applyRecipe(
  form: HTMLFormElement,
  recipe: Recipe,
  source: SourceInfo | undefined,
  limit: SizeLimit,
): void {
  const engine = engineOf(form);
  const chosen =
    engine === 'goldsrc' && (recipe === 'animated' || recipe === 'fading')
      ? 'still'
      : recipe;
  const still = engine === 'goldsrc' ? 112 : limit === 'modern' ? 512 : 256;
  const values: Record<string, string | boolean> = {
    recipe: chosen,
    format: 'auto',
    resizeFilter: 'catrom',
    mipmaps: true,
    mipSharpen: 'soft',
    fade: 'none',
    fit: 'cover',
    dither: true,
    // Clean up cut-out edges whenever the source has transparency.
    defringe: source?.hasAlpha ? '2' : '0',
    bleed: true,
    maxFrames: '0',
    size: `${still}x${still}`,
  };

  if (chosen === 'animated') {
    const size = source ? animatedSize(source, limit) : 128;
    Object.assign(values, { mipmaps: false, size: `${size}x${size}` });
  } else if (chosen === 'fading') {
    values.fade = source?.hasFadeImage ? 'image' : 'out';
  } else if (chosen === 'pixel') {
    const size = pixelArtSize(source, engine);
    Object.assign(values, {
      size: `${size}x${size}`,
      resizeFilter: 'point',
      format: String(ImageFormat.BGRA8888),
      mipmaps: false,
      fit: 'contain',
      dither: false,
    });
  }

  fillSizeOptions(sizeSelect(form), engine, String(values.size));
  for (const [name, value] of Object.entries(values)) {
    if (name !== 'size') setField(form, name, value);
  }
  setFlag(form, TextureFlag.POINTSAMPLE, chosen === 'pixel');
  updateFadeLevels(form);
}

/**
 * Rebuilds the fade level list for the current size, keeping the selection if it
 * still exists.
 */
export function updateFadeLevels(form: HTMLFormElement): void {
  const select = form.elements.namedItem('fadeLevel') as HTMLSelectElement;
  const [width, height] = sizeSelect(form).value.split('x').map(Number);
  const previous = select.value || '1';
  const levels = Array.from(
    { length: Math.max(0, mipCount(width, height) - 1) },
    (_, index) => {
      const level = index + 1;
      const [levelWidth, levelHeight] = mipSize(width, height, level);
      return new Option(`Level ${level} (${levelWidth} × ${levelHeight})`, String(level));
    },
  );
  select.replaceChildren(...levels);
  select.value = select.querySelector(`option[value="${previous}"]`) ? previous : '1';
}

/**
 * Shows or hides controls that only matter for certain settings, and keeps the
 * value labels next to sliders up to date.
 */
export function syncVisibility(form: HTMLFormElement): void {
  const { settings } = readForm(form);
  const source = settings.engine === 'source';
  const oneBitFormats: (string | number)[] = [
    ImageFormat.DXT1_ONEBITALPHA,
    ImageFormat.BGRA5551,
  ];
  const conditions: Record<string, boolean> = {
    source,
    goldsrc: !source,
    mipmaps: settings.mipmaps,
    unsharp: settings.mipmaps && settings.mipSharpen === 'unsharp',
    fade: settings.fade !== 'none',
    'fade-image': settings.fade === 'image',
    'one-bit': !source || oneBitFormats.includes(settings.format),
  };
  for (const element of form.querySelectorAll<HTMLElement>('[data-show]')) {
    element.hidden = !conditions[element.dataset.show ?? ''];
  }
  for (const option of form.querySelectorAll<HTMLOptionElement>('option[data-engine]')) {
    option.disabled = option.dataset.engine !== settings.engine;
  }
  for (const output of form.querySelectorAll<HTMLOutputElement>('.row--range output')) {
    const input = output.parentElement?.querySelector('input');
    if (input) output.value = `${input.value}${output.dataset.unit ?? ''}`;
  }
}
