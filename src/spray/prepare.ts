import { adjust, defringe, sharpen } from '../image/filters';
import { blit, createImage, type FloatImage, type RGBAImage } from '../image/image';
import { resample } from '../image/resample';
import type { SpraySettings } from './settings';

/**
 * Scales and positions a source image on the spray canvas according to the fit
 * mode, zoom and pan.
 */
export function placeImage(
  source: RGBAImage | FloatImage,
  settings: SpraySettings,
): FloatImage {
  const { width, height, fit, zoom, offsetX, offsetY } = settings;
  let scaleX = (width / source.width) * zoom;
  let scaleY = (height / source.height) * zoom;
  if (fit !== 'stretch') {
    const pick = fit === 'cover' ? Math.max : Math.min;
    scaleX = scaleY = pick(width / source.width, height / source.height) * zoom;
  }

  const scaledWidth = source.width * scaleX;
  const scaledHeight = source.height * scaleY;
  const left = (width - scaledWidth) / 2 + (offsetX * Math.abs(scaledWidth - width)) / 2;
  const top =
    (height - scaledHeight) / 2 + (offsetY * Math.abs(scaledHeight - height)) / 2;
  const startColumn = Math.max(0, Math.round(left));
  const startRow = Math.max(0, Math.round(top));
  const endColumn = Math.min(width, Math.round(left + scaledWidth));
  const endRow = Math.min(height, Math.round(top + scaledHeight));

  const canvas = createImage(width, height);
  if (endColumn <= startColumn || endRow <= startRow) return canvas;
  const area = {
    left: (startColumn - left) / scaleX,
    top: (startRow - top) / scaleY,
    width: (endColumn - startColumn) / scaleX,
    height: (endRow - startRow) / scaleY,
  };
  const placed = resample(
    source,
    area,
    endColumn - startColumn,
    endRow - startRow,
    settings.resizeFilter,
  );
  blit(placed, canvas, startColumn, startRow);
  return canvas;
}

/**
 * Frames, defringes, colour adjusts and sharpens one source image at full spray size.
 */
export function prepareImage(source: RGBAImage, settings: SpraySettings): FloatImage {
  const placed = placeImage(source, settings);
  if (settings.defringe > 0) defringe(placed, settings.defringe);
  adjust(placed, settings.adjust);
  if (settings.imageSharpen <= 0) return placed;
  return sharpen(placed, 'unsharp', {
    radius: 1,
    amount: settings.imageSharpen,
    threshold: 0,
  });
}
