import type { RGBAImage } from '../image/image';

/**
 * TGA image types this decoder understands: true colour and greyscale, raw (2, 3)
 * or run length encoded (10, 11).
 */
const SUPPORTED_TYPES = [2, 3, 10, 11];

/**
 * Decodes a Targa image. Browsers can't open TGA, but it's the format VTFEdit
 * works with. Supports true colour and greyscale images, raw or RLE compressed,
 * at 8, 16, 24 or 32 bits.
 */
export function decodeTga(buffer: ArrayBuffer): RGBAImage {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const idLength = bytes[0];
  const hasColourMap = bytes[1] !== 0;
  const type = bytes[2];
  const colourMapLength = view.getUint16(5, true);
  const colourMapDepth = bytes[7];
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const depth = bytes[16];
  const descriptor = bytes[17];

  if (!SUPPORTED_TYPES.includes(type) || ![8, 16, 24, 32].includes(depth)) {
    throw new Error('Unsupported TGA type. Save it as 24 or 32-bit true colour.');
  }
  const greyscale = type === 3 || type === 11;
  const runLengthEncoded = type >= 9;
  const bytesPerPixel = depth / 8;
  const colourMapBytes = hasColourMap
    ? colourMapLength * Math.ceil(colourMapDepth / 8)
    : 0;
  let offset = 18 + idLength + colourMapBytes;
  const data = new Uint8ClampedArray(width * height * 4);

  /**
   * Reads the pixel at the current offset into the output at `target`.
   */
  const readPixel = (target: number): void => {
    if (greyscale) {
      data.fill(bytes[offset], target, target + 3);
      data[target + 3] = depth === 16 ? bytes[offset + 1] : 255;
    } else if (depth === 16) {
      const packed = bytes[offset] | (bytes[offset + 1] << 8);
      data[target] = ((packed >> 10) & 31) * (255 / 31);
      data[target + 1] = ((packed >> 5) & 31) * (255 / 31);
      data[target + 2] = (packed & 31) * (255 / 31);
      data[target + 3] = 255;
    } else {
      data[target] = bytes[offset + 2];
      data[target + 1] = bytes[offset + 1];
      data[target + 2] = bytes[offset];
      data[target + 3] = depth === 32 ? bytes[offset + 3] : 255;
    }
  };

  // Rows are stored bottom-up unless bit 5 of the descriptor is set.
  const topDown = (descriptor & 0x20) !== 0;

  /**
   * Where pixel number `pixel` (in file order) belongs in the output.
   */
  const targetOf = (pixel: number): number => {
    const column = pixel % width;
    const row = (pixel - column) / width;
    return ((topDown ? row : height - 1 - row) * width + column) * 4;
  };

  const pixelCount = width * height;
  let pixel = 0;
  while (pixel < pixelCount) {
    let runLength = 1;
    let repeated = false;
    if (runLengthEncoded) {
      const packetHeader = bytes[offset++];
      runLength = (packetHeader & 0x7f) + 1;
      repeated = (packetHeader & 0x80) !== 0;
    }
    for (let count = 0; count < runLength && pixel < pixelCount; count++, pixel++) {
      readPixel(targetOf(pixel));
      if (!repeated) offset += bytesPerPixel;
    }
    if (repeated) offset += bytesPerPixel;
  }

  // Some tools write 32-bit TGAs with an empty alpha channel; treat those as opaque.
  const alphaBits = descriptor & 0x0f;
  if (depth === 32 && alphaBits === 0) {
    let empty = true;
    for (let alpha = 3; alpha < data.length && empty; alpha += 4) {
      empty = data[alpha] === 0;
    }
    if (empty) for (let alpha = 3; alpha < data.length; alpha += 4) data[alpha] = 255;
  }

  return { width, height, data };
}
