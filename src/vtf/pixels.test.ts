import { describe, expect, it } from 'vitest';
import { ImageFormat } from './format';
import { decodePixels, encodePixels } from './pixels';

const pixel = new Uint8ClampedArray([255, 128, 0, 200]);

describe('uncompressed formats', () => {
  it('stores BGRA8888 in blue, green, red, alpha byte order', () => {
    const out = encodePixels(pixel, 1, 1, ImageFormat.BGRA8888);
    expect([...out]).toEqual([0, 128, 255, 200]);
    expect([...decodePixels(out, 1, 1, ImageFormat.BGRA8888)]).toEqual([...pixel]);
  });

  it('packs BGRA4444 with blue in the lowest bits', () => {
    const out = encodePixels(pixel, 1, 1, ImageFormat.BGRA4444);
    // A=12 (200/17), R=15, G=8, B=0 -> 0xC F 8 0.
    expect([...out]).toEqual([0x80, 0xcf]);
  });

  it('packs BGR565 with red in the highest bits', () => {
    const out = encodePixels(
      new Uint8ClampedArray([255, 0, 0, 255]),
      1,
      1,
      ImageFormat.BGR565,
    );
    expect([...out]).toEqual([0x00, 0xf8]);
  });

  it('round trips low bit depth formats within their precision', () => {
    for (const format of [
      ImageFormat.BGRA4444,
      ImageFormat.BGRA5551,
      ImageFormat.BGR565,
    ]) {
      const decoded = decodePixels(encodePixels(pixel, 1, 1, format), 1, 1, format);
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(decoded[channel] - pixel[channel])).toBeLessThanOrEqual(9);
      }
    }
  });

  it('converts to luminance for I8 and keeps alpha for IA88', () => {
    const out = encodePixels(pixel, 1, 1, ImageFormat.IA88);
    expect(out[0]).toBe(Math.round(255 * 0.299 + 128 * 0.587));
    expect(out[1]).toBe(200);
    const decoded = decodePixels(
      encodePixels(pixel, 1, 1, ImageFormat.I8),
      1,
      1,
      ImageFormat.I8,
    );
    expect(decoded[3]).toBe(255);
  });
});
