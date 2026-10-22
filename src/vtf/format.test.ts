import { describe, expect, it } from 'vitest';
import { ImageFormat, frameSize, headerSize, mipCount, thumbnailSize } from './format';

describe('format helpers', () => {
  it('counts mips down to 1x1', () => {
    expect(mipCount(256, 256)).toBe(9);
    expect(mipCount(256, 128)).toBe(9);
    expect(mipCount(1, 1)).toBe(1);
  });

  it('pads DXT mips below 4x4 to a full block', () => {
    // 4x4, 2x2 and 1x1 all take one 16 byte block.
    expect(frameSize(4, 4, ImageFormat.DXT5, 3)).toBe(48);
  });

  it('matches VTFLib header sizes', () => {
    expect(headerSize(1, 0)).toBe(64);
    expect(headerSize(2, 0)).toBe(80);
    expect(headerSize(3, 2)).toBe(96);
  });

  it('picks a 16x16 thumbnail, keeping aspect ratio', () => {
    expect(thumbnailSize(512, 512)).toEqual([16, 16]);
    expect(thumbnailSize(256, 128)).toEqual([16, 8]);
    expect(thumbnailSize(8, 8)).toEqual([8, 8]);
  });
});
