import { describe, expect, it } from 'vitest';
import { decodeTga } from './tga';

/**
 * Builds a 2x1 TGA file from an image type, bit depth, descriptor and pixel bytes.
 */
function buildTga(
  type: number,
  depth: number,
  descriptor: number,
  body: number[],
): ArrayBuffer {
  const header = new Uint8Array(18);
  header[2] = type;
  header[12] = 2; // 2x1 image.
  header[14] = 1;
  header[16] = depth;
  header[17] = descriptor;
  return new Uint8Array([...header, ...body]).buffer;
}

describe('decodeTga', () => {
  it('reads uncompressed 24-bit BGR', () => {
    const image = decodeTga(buildTga(2, 24, 0, [0, 0, 255, 255, 0, 0]));
    expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('reads RLE 32-bit with alpha', () => {
    // One run packet repeating a half transparent green pixel twice.
    const image = decodeTga(buildTga(10, 32, 8, [0x81, 0, 255, 0, 128]));
    expect([...image.data]).toEqual([0, 255, 0, 128, 0, 255, 0, 128]);
  });

  it('treats an empty alpha channel as opaque', () => {
    const image = decodeTga(buildTga(2, 32, 0, [1, 2, 3, 0, 4, 5, 6, 0]));
    expect(image.data[3]).toBe(255);
  });
});
