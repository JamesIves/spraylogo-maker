import { describe, expect, it } from 'vitest';
import { ImageFormat } from '../vtf/format';
import { SIZE_LIMITS, maxFrames, type BudgetSettings } from './budget';

/**
 * Settings for a spray of the given size, as VTFEdit would make it.
 */
const settings = (size: number, mipmaps: boolean, height = size): BudgetSettings => ({
  width: size,
  height,
  mipmaps,
  version: 2,
  thumbnail: true,
});

// Known frame counts for animated sprays at each size and format.
describe('maxFrames', () => {
  const { DXT1, DXT5 } = ImageFormat;

  it.each([
    [128, DXT5, true, 23],
    [256, DXT5, true, 5],
    [512, DXT5, true, 1],
    [128, DXT5, false, 31],
    [256, DXT5, false, 7],
    [128, DXT1, true, 47],
    [256, DXT1, true, 11],
    [512, DXT1, true, 2],
    [128, DXT1, false, 63],
    [256, DXT1, false, 15],
    [512, DXT1, false, 3],
  ])(
    '%ix%i format %i mipmaps %s fits %i frames in 512 KB',
    (size, format, mips, frames) => {
      expect(maxFrames(settings(size, mips), format, SIZE_LIMITS.modern)).toBe(frames);
    },
  );

  it('handles 2:1 sprays', () => {
    expect(maxFrames(settings(256, true, 128), DXT5, SIZE_LIMITS.modern)).toBe(11);
    expect(maxFrames(settings(512, false, 256), DXT1, SIZE_LIMITS.modern)).toBe(7);
  });

  it('uses the older 120 KB limit', () => {
    expect(maxFrames(settings(64, true), DXT5, SIZE_LIMITS.legacy)).toBe(22);
    expect(maxFrames(settings(128, true), DXT5, SIZE_LIMITS.legacy)).toBe(5);
    expect(maxFrames(settings(64, true), DXT1, SIZE_LIMITS.legacy)).toBe(44);
  });

  // Small uncompressed sprite sprays.
  it('fits uncompressed sprite frames', () => {
    const { BGRA8888, BGRA4444 } = ImageFormat;
    expect(maxFrames(settings(32, false), BGRA8888, SIZE_LIMITS.modern)).toBe(127);
    expect(maxFrames(settings(64, false), BGRA4444, SIZE_LIMITS.modern)).toBe(63);
    expect(maxFrames(settings(16, false), BGRA8888, SIZE_LIMITS.legacy)).toBe(119);
  });
});
