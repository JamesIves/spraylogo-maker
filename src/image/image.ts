/**
 * 8-bit RGBA pixels with straight (not premultiplied) alpha. Has the same shape as
 * the browser's `ImageData`.
 */
export interface RGBAImage {
  /**
   * Width in pixels.
   */
  width: number;
  /**
   * Height in pixels.
   */
  height: number;
  /**
   * Pixels in rows, four bytes (red, green, blue, alpha) each.
   */
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * RGBA pixels as 0-1 floats with straight alpha, used while processing.
 */
export interface FloatImage {
  /**
   * Width in pixels.
   */
  width: number;
  /**
   * Height in pixels.
   */
  height: number;
  /**
   * Pixels in rows, four floats (red, green, blue, alpha) each.
   */
  data: Float32Array;
}

/**
 * Converts 8-bit pixels to floats.
 */
export function toFloat({ width, height, data }: RGBAImage): FloatImage {
  const output = new Float32Array(data.length);
  for (let index = 0; index < data.length; index++) output[index] = data[index] / 255;
  return { width, height, data: output };
}

/**
 * Converts float pixels back to 8-bit.
 */
export function toBytes({ width, height, data }: FloatImage): RGBAImage {
  const output = new Uint8ClampedArray(data.length);
  for (let index = 0; index < data.length; index++) {
    output[index] = Math.round(data[index] * 255);
  }
  return { width, height, data: output };
}

/**
 * Creates a fully transparent image.
 */
export function createImage(width: number, height: number): FloatImage {
  return { width, height, data: new Float32Array(width * height * 4) };
}

/**
 * Copies an image so the original can be left untouched.
 */
export function cloneImage(image: FloatImage): FloatImage {
  return { ...image, data: image.data.slice() };
}

/**
 * True when any pixel would be less than fully opaque once stored as 8-bit.
 */
export function hasTransparency({ data }: FloatImage | RGBAImage): boolean {
  const opaque = data instanceof Float32Array ? 254.5 / 255 : 255;
  for (let alpha = 3; alpha < data.length; alpha += 4) {
    if (data[alpha] < opaque) return true;
  }
  return false;
}

/**
 * Copies `source` into `target` with its top left corner at (`left`, `top`),
 * clipping to the target's bounds.
 */
export function blit(
  source: FloatImage,
  target: FloatImage,
  left: number,
  top: number,
): void {
  for (let row = 0; row < source.height; row++) {
    const targetRow = top + row;
    if (targetRow < 0 || targetRow >= target.height) continue;
    for (let column = 0; column < source.width; column++) {
      const targetColumn = left + column;
      if (targetColumn < 0 || targetColumn >= target.width) continue;
      const from = (row * source.width + column) * 4;
      target.data.set(
        source.data.subarray(from, from + 4),
        (targetRow * target.width + targetColumn) * 4,
      );
    }
  }
}
