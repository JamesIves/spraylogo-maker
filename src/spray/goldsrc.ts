import { buildPalette, mapToPalette } from '../goldsrc/palette';
import {
  DECAL_MIP_LEVELS,
  DECAL_NAME,
  TRANSPARENT_INDEX,
  isValidDecalSize,
  writeDecalWad,
} from '../goldsrc/wad';
import { hasTransparency, toBytes, type RGBAImage } from '../image/image';
import { resize } from '../image/resample';
import { prepareImage } from './prepare';
import type { SprayResult, SpraySettings } from './settings';

/**
 * Colour stored in the transparent palette slot. Pure blue by convention, so the
 * transparent areas are obvious in other tools.
 */
const TRANSPARENT_COLOUR = [0, 0, 255];

/**
 * Converts an image into a `tempdecal.wad` spray for GoldSrc games. GoldSrc sprays
 * are a single 8-bit paletted image with on/off transparency, so only the first
 * frame is used.
 */
export function buildGoldSrcSpray(
  frames: RGBAImage[],
  settings: SpraySettings,
): SprayResult {
  const { width, height } = settings;
  if (!isValidDecalSize(width, height)) {
    throw new Error(`${width} × ${height} is too big for a GoldSrc spray.`);
  }

  const top = prepareImage(frames[0], settings);
  const levels = Array.from({ length: DECAL_MIP_LEVELS }, (_, level) =>
    toBytes(level === 0 ? top : resize(top, width >> level, height >> level, 'box')),
  );

  // The last palette slot is reserved for transparency, leaving 255 for colours.
  const colours = buildPalette(levels[0], TRANSPARENT_INDEX, settings.alphaThreshold);
  const palette = new Uint8Array(256 * 3);
  palette.set(colours);
  palette.set(TRANSPARENT_COLOUR, TRANSPARENT_INDEX * 3);

  const mips = levels.map((level) =>
    mapToPalette(level, palette, {
      dither: settings.dither,
      alphaThreshold: settings.alphaThreshold,
      transparentIndex: TRANSPARENT_INDEX,
    }),
  );

  return {
    engine: 'goldsrc',
    bytes: writeDecalWad({ name: DECAL_NAME, width, height, mips, palette }),
    formatName: `8-bit, ${colours.length / 3} colours${hasTransparency(levels[0]) ? ' + transparent' : ''}`,
    flags: 0,
    mips: DECAL_MIP_LEVELS,
    frames: 1,
    hasAlpha: hasTransparency(levels[0]),
  };
}
