import type { RGBAImage } from '../image/image';

/**
 * Draws a small, aspect correct copy of an image onto a canvas.
 */
export function drawThumbnail(image: RGBAImage, canvas: HTMLCanvasElement): void {
  const source = new OffscreenCanvas(image.width, image.height);
  source
    .getContext('2d')
    ?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const context = canvas.getContext('2d');
  if (!context) return;
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    (canvas.width - width) / 2,
    (canvas.height - height) / 2,
    width,
    height,
  );
}

/**
 * Creates a new square thumbnail canvas.
 */
export function createThumbnail(image: RGBAImage, size = 56): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  drawThumbnail(image, canvas);
  return canvas;
}
