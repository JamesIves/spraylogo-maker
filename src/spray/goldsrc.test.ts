import { describe, expect, it } from 'vitest';
import { decodeDecalMip, readDecalWad } from '../goldsrc/wad';
import type { RGBAImage } from '../image/image';
import { buildGoldSrcSpray } from './goldsrc';
import { DEFAULT_SETTINGS, type SpraySettings } from './settings';

/**
 * Default settings for a GoldSrc spray of the given size.
 */
function goldsrcSettings(width: number, height: number): SpraySettings {
  return { ...DEFAULT_SETTINGS, engine: 'goldsrc', width, height };
}

/**
 * A red square on a transparent background.
 */
function redSquare(size: number): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const inside =
        row >= size / 4 &&
        row < (size * 3) / 4 &&
        column >= size / 4 &&
        column < (size * 3) / 4;
      data.set(inside ? [255, 0, 0, 255] : [0, 0, 0, 0], (row * size + column) * 4);
    }
  }
  return { width: size, height: size, data };
}

describe('buildGoldSrcSpray', () => {
  it('writes a tempdecal.wad with four mip levels', () => {
    const result = buildGoldSrcSpray([redSquare(200)], goldsrcSettings(64, 64));
    const texture = readDecalWad(result.bytes);
    expect(result.engine).toBe('goldsrc');
    expect(texture.name).toBe('{LOGO');
    expect(texture.mips.map((mip) => mip.length)).toEqual([4096, 1024, 256, 64]);
  });

  it('keeps colours and transparency', () => {
    const result = buildGoldSrcSpray([redSquare(64)], goldsrcSettings(64, 64));
    const { data } = decodeDecalMip(readDecalWad(result.bytes), 0);
    const centre = (32 * 64 + 32) * 4;
    expect([...data.slice(centre, centre + 4)]).toEqual([255, 0, 0, 255]);
    expect(data[3]).toBe(0);
    expect(result.hasAlpha).toBe(true);
  });

  it('rejects sizes the game would refuse', () => {
    expect(() => buildGoldSrcSpray([redSquare(64)], goldsrcSettings(128, 128))).toThrow();
  });
});
