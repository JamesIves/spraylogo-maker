import { describe, expect, it } from 'vitest';
import type { RGBAImage } from '../image/image';
import { buildPalette, mapToPalette } from './palette';

/**
 * A horizontal rainbow gradient, `width` pixels wide and 8 tall.
 */
function gradient(width: number): RGBAImage {
  const data = new Uint8ClampedArray(width * 8 * 4);
  for (let pixel = 0; pixel < width * 8; pixel++) {
    const column = pixel % width;
    data.set(
      [(column * 7) % 256, (column * 13) % 256, (column * 29) % 256, 255],
      pixel * 4,
    );
  }
  return { width, height: 8, data };
}

const mapping = { dither: false, alphaThreshold: 128, transparentIndex: 255 };

describe('palette', () => {
  it('keeps every colour when there are few enough', () => {
    const image: RGBAImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
    };
    const palette = buildPalette(image, 255, 128);
    expect(palette).toHaveLength(6);
    expect([...mapToPalette(image, palette, mapping)]).toEqual([0, 1]);
  });

  it('reduces many colours to the maximum', () => {
    expect(buildPalette(gradient(512), 255, 128).length / 3).toBeLessThanOrEqual(255);
  });

  it('keeps the mapped image close to the original', () => {
    const image = gradient(512);
    const palette = buildPalette(image, 255, 128);
    const indices = mapToPalette(image, palette, mapping);
    let error = 0;
    indices.forEach((entry, pixel) => {
      for (let channel = 0; channel < 3; channel++) {
        error += Math.abs(palette[entry * 3 + channel] - image.data[pixel * 4 + channel]);
      }
    });
    expect(error / (indices.length * 3)).toBeLessThan(8);
  });

  it('gives transparent pixels the transparent index', () => {
    const image: RGBAImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 10]),
    };
    const indices = mapToPalette(image, buildPalette(image, 255, 128), mapping);
    expect(indices[1]).toBe(255);
  });

  it('never uses the transparent index for visible pixels when dithering', () => {
    const image = gradient(256);
    const palette = new Uint8Array(256 * 3);
    palette.set(buildPalette(image, 255, 128));
    const indices = mapToPalette(image, palette, { ...mapping, dither: true });
    expect(indices.includes(255)).toBe(false);
  });
});
