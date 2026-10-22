import { bitsPerPixel, formatInfo, type Channel, type ImageFormat } from './format';

/**
 * 4x4 Bayer matrix, used for ordered dithering of low bit depth formats.
 */
const BAYER_MATRIX = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Rec. 601 luma, the weighting VTFEdit uses for the I8 and IA88 formats.
 */
const luminance = (red: number, green: number, blue: number): number =>
  Math.round(red * 0.299 + green * 0.587 + blue * 0.114);

/**
 * Reads one channel of the pixel at `offset`, working out luminance or padding
 * where needed.
 */
function channelValue(rgba: ArrayLike<number>, offset: number, channel: Channel): number {
  switch (channel) {
    case 'r':
      return rgba[offset];
    case 'g':
      return rgba[offset + 1];
    case 'b':
      return rgba[offset + 2];
    case 'a':
      return rgba[offset + 3];
    case 'l':
      return luminance(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
    case 'x':
      return 255;
  }
}

/**
 * Packs RGBA pixels into an uncompressed VTF format such as BGRA8888 or BGRA4444.
 * Colour channels below 8 bits can be dithered to hide banding.
 */
export function encodePixels(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  format: ImageFormat,
  dither = false,
): Uint8Array {
  const info = formatInfo(format);
  const bytesPerPixel = bitsPerPixel(info) / 8;
  const output = new Uint8Array(width * height * bytesPerPixel);

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const pixel = row * width + column;
      const threshold = BAYER_MATRIX[(row & 3) * 4 + (column & 3)] / 16 - 0.5;
      let packedValue = 0;
      let shift = 0;

      for (const [channel, bits] of info.layout) {
        const maximum = (1 << bits) - 1;
        let value = channelValue(rgba, pixel * 4, channel);
        if (dither && bits < 8 && channel !== 'a' && channel !== 'x') {
          value += (threshold * 255) / maximum;
        }
        const quantised = Math.min(
          maximum,
          Math.max(0, Math.round((value * maximum) / 255)),
        );
        // Multiply rather than shift so 32-bit values stay unsigned.
        packedValue += quantised * 2 ** shift;
        shift += bits;
      }

      for (let byte = 0; byte < bytesPerPixel; byte++) {
        output[pixel * bytesPerPixel + byte] = packedValue & 0xff;
        packedValue = Math.floor(packedValue / 256);
      }
    }
  }
  return output;
}

/**
 * Unpacks an uncompressed VTF format back into RGBA pixels.
 */
export function decodePixels(
  data: Uint8Array,
  width: number,
  height: number,
  format: ImageFormat,
): Uint8ClampedArray<ArrayBuffer> {
  const info = formatInfo(format);
  const bytesPerPixel = bitsPerPixel(info) / 8;
  const hasAlpha = info.layout.some(([channel]) => channel === 'a');
  const output = new Uint8ClampedArray(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel++) {
    let packedValue = 0;
    for (let byte = bytesPerPixel - 1; byte >= 0; byte--) {
      packedValue = packedValue * 256 + data[pixel * bytesPerPixel + byte];
    }
    const offset = pixel * 4;
    if (!hasAlpha) output[offset + 3] = 255;

    for (const [channel, bits] of info.layout) {
      const levels = 2 ** bits;
      const value = Math.round(((packedValue % levels) * 255) / (levels - 1));
      packedValue = Math.floor(packedValue / levels);
      if (channel === 'l') {
        output.fill(value, offset, offset + 3);
      } else if (channel !== 'x') {
        output[offset + 'rgba'.indexOf(channel)] = value;
      }
    }
  }
  return output;
}
