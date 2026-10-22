import { describe, expect, it } from 'vitest';
import { ImageFormat, TextureFlag } from './format';
import { decodeVtfFrame, readVtf, writeVtf, type VtfData } from './vtf';

/**
 * A 4x4 BGRA8888 texture with two frames: one red, one green.
 */
function twoFrameTexture(version: number): VtfData {
  /**
   * A frame filled with one BGRA colour.
   */
  const frame = (blue: number, green: number, red: number): Uint8Array =>
    new Uint8Array(4 * 4 * 4).map((_, index) => [blue, green, red, 255][index % 4]);
  return {
    version,
    width: 4,
    height: 4,
    format: ImageFormat.BGRA8888,
    flags: TextureFlag.CLAMPS | TextureFlag.NOMIP,
    frames: 2,
    mips: 1,
    reflectivity: [0.5, 0.25, 0.125],
    levels: [[frame(0, 0, 255), frame(0, 255, 0)]],
  };
}

describe('VTF files', () => {
  it.each([0, 1, 2, 3, 4, 5])('round trips version 7.%i', (version) => {
    const vtf = readVtf(writeVtf(twoFrameTexture(version)));
    expect(vtf.version).toBe(version);
    expect(vtf.flags).toBe(TextureFlag.CLAMPS | TextureFlag.NOMIP);
    expect(vtf.reflectivity).toEqual([0.5, 0.25, 0.125]);
    expect([...decodeVtfFrame(vtf, 0, 0).data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...decodeVtfFrame(vtf, 1, 0).data.slice(0, 4)]).toEqual([0, 255, 0, 255]);
  });

  it('starts with the VTF signature and version', () => {
    const bytes = writeVtf(twoFrameTexture(2));
    expect(String.fromCharCode(...bytes.slice(0, 3))).toBe('VTF');
    expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(7);
  });

  it('rejects files that are not VTFs', () => {
    expect(() => readVtf(new Uint8Array(80))).toThrow('Not a VTF file.');
  });
});
