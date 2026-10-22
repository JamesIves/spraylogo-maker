import {
  ImageFormat,
  frameSize,
  headerSize,
  imageSize,
  mipCount,
  thumbnailSize,
} from '../vtf/format';
import type { SpraySettings } from './settings';

/**
 * Largest VTF the game will accept: 512 KB since the 2010 update, 120 KB before.
 */
export const SIZE_LIMITS = {
  modern: 512 * 1024,
  legacy: 120 * 1024,
} as const;

/**
 * Which Source size limit to check against.
 */
export type SizeLimit = keyof typeof SIZE_LIMITS;

/**
 * The settings that decide how big a VTF spray file is.
 */
export type BudgetSettings = Pick<
  SpraySettings,
  'width' | 'height' | 'mipmaps' | 'version' | 'thumbnail'
>;

/**
 * Bytes every file has regardless of frame count: the header and thumbnail.
 */
function fixedBytes(settings: BudgetSettings): number {
  const thumbnail = settings.thumbnail
    ? imageSize(...thumbnailSize(settings.width, settings.height), ImageFormat.DXT1)
    : 0;
  const resources = settings.version >= 3 ? (settings.thumbnail ? 2 : 1) : 0;
  return headerSize(settings.version, resources) + thumbnail;
}

/**
 * Bytes one frame takes, including its mipmaps.
 */
function frameBytes(settings: BudgetSettings, format: ImageFormat): number {
  const mips = settings.mipmaps ? mipCount(settings.width, settings.height) : 1;
  return frameSize(settings.width, settings.height, format, mips);
}

/**
 * Exact size in bytes of the VTF the Source spray builder will write.
 */
export function estimateSize(
  settings: BudgetSettings,
  format: ImageFormat,
  frames: number,
): number {
  return fixedBytes(settings) + frameBytes(settings, format) * frames;
}

/**
 * How many frames fit under a size limit.
 */
export function maxFrames(
  settings: BudgetSettings,
  format: ImageFormat,
  limit: number,
): number {
  return Math.max(
    0,
    Math.floor((limit - fixedBytes(settings)) / frameBytes(settings, format)),
  );
}
