import { describe, expect, it } from 'vitest';
import { decodeDxt, encodeDxt, type DxtQuality, type DxtVariant } from './dxt';

/**
 * A smooth gradient with a circular alpha mask and a little repeatable noise.
 */
function testImage(width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 1;

  /**
   * Small, repeatable noise from a seeded random number generator.
   */
  const noise = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed % 9) - 4;
  };

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const pixel = (row * width + column) * 4;
      data[pixel] = (column / width) * 255 + noise();
      data[pixel + 1] = (row / height) * 255 + noise();
      data[pixel + 2] = 128 + noise() * 4;
      const distance = Math.hypot(column - width / 2, row - height / 2) / (width / 2);
      data[pixel + 3] = distance < 0.6 ? 255 : distance < 0.8 ? 128 : 0;
    }
  }
  return data;
}

/**
 * Root mean squared error of the colour channels, counting only opaque pixels.
 */
function colourError(original: ArrayLike<number>, decoded: ArrayLike<number>): number {
  let total = 0;
  let count = 0;
  for (let pixel = 0; pixel < original.length; pixel += 4) {
    if (original[pixel + 3] < 128) continue;
    for (let channel = 0; channel < 3; channel++) {
      total += (original[pixel + channel] - decoded[pixel + channel]) ** 2;
    }
    count += 3;
  }
  return Math.sqrt(total / count);
}

/**
 * Encodes then decodes an image, to see what compression keeps.
 */
function roundTrip(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  variant: DxtVariant,
  quality: DxtQuality = 'normal',
): Uint8ClampedArray {
  return decodeDxt(
    encodeDxt(data, width, height, variant, { quality }),
    width,
    height,
    variant,
  );
}

describe('DXT', () => {
  it('produces the right amount of data', () => {
    const data = testImage(64, 32);
    expect(encodeDxt(data, 64, 32, 'dxt1')).toHaveLength(16 * 8 * 8);
    expect(encodeDxt(data, 64, 32, 'dxt5')).toHaveLength(16 * 8 * 16);
    expect(encodeDxt(data, 2, 2, 'dxt5')).toHaveLength(16);
  });

  it.each(['dxt1', 'dxt5'] as const)('keeps %s colour error low', (variant) => {
    const data = testImage(64, 64);
    expect(colourError(data, roundTrip(data, 64, 64, variant))).toBeLessThan(6);
  });

  it('gets more accurate with more effort', () => {
    const data = testImage(64, 64);
    const fast = colourError(data, roundTrip(data, 64, 64, 'dxt1', 'fast'));
    const best = colourError(data, roundTrip(data, 64, 64, 'dxt1', 'best'));
    expect(best).toBeLessThanOrEqual(fast);
  });

  it('reproduces solid colours closely', () => {
    const data = new Uint8ClampedArray(16 * 4);
    for (let pixel = 0; pixel < 16; pixel++) data.set([200, 100, 37, 255], pixel * 4);
    const decoded = roundTrip(data, 4, 4, 'dxt1');
    expect(Math.abs(decoded[0] - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(decoded[1] - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(decoded[2] - 37)).toBeLessThanOrEqual(2);
    expect(decoded[3]).toBe(255);
  });

  it('never makes opaque DXT1 pixels transparent', () => {
    const data = testImage(32, 32);
    for (let alpha = 3; alpha < data.length; alpha += 4) data[alpha] = 255;
    const decoded = roundTrip(data, 32, 32, 'dxt1', 'best');
    expect(
      decoded.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255),
    ).toBe(true);
  });

  it('keeps DXT5 alpha accurate, including exact 0 and 255', () => {
    const data = testImage(32, 32);
    const decoded = roundTrip(data, 32, 32, 'dxt5');
    const exact = [];
    const partial = [];
    for (let alpha = 3; alpha < data.length; alpha += 4) {
      if (data[alpha] === 0 || data[alpha] === 255) {
        exact.push(decoded[alpha] === data[alpha]);
      } else partial.push(Math.abs(decoded[alpha] - data[alpha]));
    }
    expect(exact.every(Boolean)).toBe(true);
    expect(Math.max(...partial)).toBeLessThanOrEqual(4);
  });

  it('cuts out DXT1 one-bit alpha at the threshold', () => {
    const data = testImage(32, 32);
    const decoded = roundTrip(data, 32, 32, 'dxt1a');
    const expected = [...data]
      .filter((_, index) => index % 4 === 3)
      .map((alpha) => (alpha >= 128 ? 255 : 0));
    expect([...decoded].filter((_, index) => index % 4 === 3)).toEqual(expected);
  });

  it('keeps the colour of fully transparent DXT5 blocks for edge filtering', () => {
    const data = new Uint8ClampedArray(16 * 4);
    for (let pixel = 0; pixel < 16; pixel++) data.set([200, 100, 50, 0], pixel * 4);
    const decoded = roundTrip(data, 4, 4, 'dxt5');
    expect(decoded[3]).toBe(0);
    expect(Math.abs(decoded[0] - 200)).toBeLessThanOrEqual(4);
  });

  it('quantises DXT3 alpha to 4 bits', () => {
    const data = testImage(16, 16);
    const decoded = roundTrip(data, 16, 16, 'dxt3');
    const expected = [...data]
      .filter((_, index) => index % 4 === 3)
      .map((alpha) => Math.round(alpha / 17) * 17);
    expect([...decoded].filter((_, index) => index % 4 === 3)).toEqual(expected);
  });
});
