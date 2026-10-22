import { bleedEdges, clearAlpha, flatten, sharpen } from '../image/filters';
import {
  cloneImage,
  hasTransparency,
  toBytes,
  type FloatImage,
  type RGBAImage,
} from '../image/image';
import { resize } from '../image/resample';
import { encodeDxt } from '../vtf/dxt';
import {
  FORMAT_INFO,
  ImageFormat,
  TextureFlag,
  mipCount,
  mipSize,
  thumbnailSize,
} from '../vtf/format';
import { encodePixels } from '../vtf/pixels';
import { dxtVariant, formatName, writeVtf, type VtfThumbnail } from '../vtf/vtf';
import { prepareImage } from './prepare';
import type { FormatChoice, SprayResult, SpraySettings } from './settings';

/**
 * Picks DXT5 for images with transparency and DXT1 otherwise, like VTFEdit does.
 */
export function resolveFormat(choice: FormatChoice, hasAlpha: boolean): ImageFormat {
  if (choice !== 'auto') return choice;
  return hasAlpha ? ImageFormat.DXT5 : ImageFormat.DXT1;
}

/**
 * Adds the flags a VTF needs for its format and mipmaps to the user's choice.
 */
export function resolveFlags(
  flags: number,
  format: ImageFormat,
  mipmaps: boolean,
): number {
  const { alphaBits } = FORMAT_INFO[format];
  let resolved = flags;
  if (alphaBits === 1) resolved |= TextureFlag.ONEBITALPHA;
  if (alphaBits > 1) resolved |= TextureFlag.EIGHTBITALPHA;
  if (!mipmaps) resolved |= TextureFlag.NOMIP | TextureFlag.NOLOD;
  return resolved;
}

/**
 * Gets transparent pixels ready for encoding: bleed edge colour under them, or
 * flatten them onto the background when the format has no alpha.
 */
function finishLevel(
  image: FloatImage,
  settings: SpraySettings,
  keepAlpha: boolean,
): FloatImage {
  if (!keepAlpha) flatten(image, settings.background);
  else if (settings.bleed) bleedEdges(image);
  return image;
}

/**
 * Builds every mip level for a frame. From `fadeLevel` down, levels either turn
 * transparent or come from the second image, which is how fading sprays work.
 */
function mipChain(
  top: FloatImage,
  fadeTop: FloatImage | undefined,
  settings: SpraySettings,
  mips: number,
  keepAlpha: boolean,
): FloatImage[] {
  const chain: FloatImage[] = [];
  for (let level = 0; level < mips; level++) {
    const fading = settings.fade !== 'none' && level >= settings.fadeLevel;
    const source = fading && fadeTop ? fadeTop : top;
    let image: FloatImage;
    if (level === 0) {
      image = cloneImage(source);
    } else {
      const [width, height] = mipSize(settings.width, settings.height, level);
      image = resize(source, width, height, settings.mipFilter);
      if (settings.mipSharpen !== 'none') {
        image = sharpen(image, settings.mipSharpen, settings.unsharp);
      }
    }
    if (fading && settings.fade === 'out') clearAlpha(image);
    chain.push(finishLevel(image, settings, keepAlpha));
  }
  return chain;
}

/**
 * Encodes one mip level in the spray's format.
 */
function encodeLevel(
  image: FloatImage,
  format: ImageFormat,
  settings: SpraySettings,
): Uint8Array {
  const { data } = toBytes(image);
  const variant = dxtVariant(format);
  if (variant) {
    return encodeDxt(data, image.width, image.height, variant, {
      quality: settings.quality,
      alphaThreshold: settings.alphaThreshold,
    });
  }
  if (FORMAT_INFO[format].alphaBits === 1) {
    for (let alpha = 3; alpha < data.length; alpha += 4) {
      data[alpha] = data[alpha] >= settings.alphaThreshold ? 255 : 0;
    }
  }
  return encodePixels(data, image.width, image.height, format, settings.dither);
}

/**
 * Average linear colour across the frames, stored in the VTF header.
 */
function reflectivity(images: FloatImage[]): [number, number, number] {
  const totals = [0, 0, 0];
  for (const { data } of images) {
    const pixels = data.length / 4;
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0;
      for (let index = channel; index < data.length; index += 4) {
        sum += data[index] ** 2.2;
      }
      totals[channel] += sum / pixels;
    }
  }
  const [red, green, blue] = totals.map((total) => total / images.length);
  return [red, green, blue];
}

/**
 * The 16x16 (or smaller) DXT1 preview, taken from a matching mip level where one
 * exists.
 */
function buildThumbnail(chain: FloatImage[], settings: SpraySettings): VtfThumbnail {
  const [width, height] = thumbnailSize(settings.width, settings.height);
  const source =
    chain.find((image) => image.width === width && image.height === height) ??
    resize(chain[0], width, height, 'box');
  const data = encodeDxt(toBytes(source).data, width, height, 'dxt1', {
    quality: 'fast',
  });
  return { width, height, data };
}

/**
 * Converts source frames into a VTF spray for Source games.
 * @param frames Source images, one per animation frame.
 * @param settings Conversion settings.
 * @param fadeImage Second image for the `image` fade mode.
 * @param onProgress Called after each frame is encoded.
 */
export function buildSourceSpray(
  frames: RGBAImage[],
  settings: SpraySettings,
  fadeImage?: RGBAImage,
  onProgress?: (done: number, total: number) => void,
): SprayResult {
  const tops = frames.map((frame) => prepareImage(frame, settings));
  const fadeTop =
    settings.fade === 'image' && fadeImage
      ? prepareImage(fadeImage, settings)
      : undefined;
  const hasAlpha =
    settings.fade === 'out' ||
    tops.some(hasTransparency) ||
    (fadeTop !== undefined && settings.mipmaps && hasTransparency(fadeTop));

  const format = resolveFormat(settings.format, hasAlpha);
  const keepAlpha = FORMAT_INFO[format].alphaBits > 0;
  const mips = settings.mipmaps ? mipCount(settings.width, settings.height) : 1;
  const levels: Uint8Array[][] = Array.from({ length: mips }, () => []);
  let firstChain: FloatImage[] = [];

  tops.forEach((top, frame) => {
    const chain = mipChain(top, fadeTop, settings, mips, keepAlpha);
    if (frame === 0) firstChain = chain;
    chain.forEach((image, level) =>
      levels[level].push(encodeLevel(image, format, settings)),
    );
    onProgress?.(frame + 1, tops.length);
  });

  const flags = resolveFlags(settings.flags, format, settings.mipmaps);
  const bytes = writeVtf({
    version: settings.version,
    width: settings.width,
    height: settings.height,
    format,
    flags,
    frames: frames.length,
    mips,
    reflectivity: settings.reflectivity ? reflectivity(tops) : [1, 1, 1],
    thumbnail: settings.thumbnail ? buildThumbnail(firstChain, settings) : undefined,
    levels,
  });

  return {
    engine: 'source',
    bytes,
    formatName: formatName(format),
    format,
    flags,
    mips,
    frames: frames.length,
    hasAlpha,
  };
}
