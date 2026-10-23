import type { RGBAImage } from '../image/image';
import { buildGoldSrcSpray } from './goldsrc';
import type { SprayResult, SpraySettings } from './settings';
import { buildSourceSpray } from './source';

/**
 * Converts source frames into a finished spray file for the chosen engine.
 * @param frames Source images, one per animation frame.
 * @param settings Conversion settings.
 * @param farImages Far away images for the `image` fade mode (Source only).
 * @param onProgress Called after each frame is encoded.
 */
export function buildSpray(
  frames: RGBAImage[],
  settings: SpraySettings,
  farImages: RGBAImage[] = [],
  onProgress?: (done: number, total: number) => void,
): SprayResult {
  if (!frames.length) throw new Error('Add at least one frame.');
  if (settings.engine === 'goldsrc') {
    const result = buildGoldSrcSpray(frames, settings);
    onProgress?.(1, 1);
    return result;
  }
  return buildSourceSpray(frames, settings, farImages, onProgress);
}
