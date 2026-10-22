import { describe, expect, it } from 'vitest';
import {
  DECAL_NAME,
  TRANSPARENT_INDEX,
  decodeDecalMip,
  isValidDecalSize,
  readDecalWad,
  writeDecalWad,
  type DecalTexture,
} from './wad';

/**
 * An 80x80 decal where every pixel uses palette entry `index`.
 */
function filledDecal(index: number): DecalTexture {
  const palette = new Uint8Array(256 * 3);
  palette.set([10, 20, 30], 0);
  palette.set([0, 0, 255], TRANSPARENT_INDEX * 3);
  const mips = [0, 1, 2, 3].map((level) =>
    new Uint8Array((80 >> level) ** 2).fill(index),
  );
  return { name: DECAL_NAME, width: 80, height: 80, mips, palette };
}

describe('tempdecal.wad', () => {
  it('matches the known size of an 80x80 spray', () => {
    // Header (12) + lump padded to 4 bytes (9312) + directory entry (32).
    expect(writeDecalWad(filledDecal(0))).toHaveLength(9356);
  });

  it('writes the WAD3 header, mip offsets and directory', () => {
    const bytes = writeDecalWad(filledDecal(0));
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('WAD3');
    expect(view.getUint32(4, true)).toBe(1);
    expect(view.getUint32(8, true)).toBe(9324);
    expect(
      [0, 1, 2, 3].map((level) => view.getUint32(12 + 24 + level * 4, true)),
    ).toEqual([40, 6440, 8040, 8440]);
    expect(view.getUint8(9324 + 12)).toBe(0x43);
  });

  it('round trips through the reader', () => {
    const texture = readDecalWad(writeDecalWad(filledDecal(0)));
    expect(texture.name).toBe(DECAL_NAME);
    expect([texture.width, texture.height]).toEqual([80, 80]);
    expect([...decodeDecalMip(texture, 0).data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect(decodeDecalMip(texture, 3).width).toBe(10);
  });

  it('treats the last palette entry as transparent', () => {
    const texture = readDecalWad(writeDecalWad(filledDecal(TRANSPARENT_INDEX)));
    expect(decodeDecalMip(texture, 0).data[3]).toBe(0);
  });

  it('accepts only sizes the game allows', () => {
    expect(isValidDecalSize(112, 128)).toBe(true);
    expect(isValidDecalSize(256, 48)).toBe(true);
    expect(isValidDecalSize(128, 128)).toBe(false);
    expect(isValidDecalSize(100, 100)).toBe(false);
    expect(isValidDecalSize(272, 16)).toBe(false);
  });
});
