import { describe, expect, it } from 'vitest';
import type { RGBAImage } from '../image/image';
import { ImageFormat, TextureFlag } from '../vtf/format';
import { decodeVtfFrame, readVtf } from '../vtf/vtf';
import { estimateSize } from './budget';
import { DEFAULT_SETTINGS, type SpraySettings } from './settings';
import { buildSourceSpray, fadeOpacity } from './source';

/**
 * A test image filled with one colour.
 */
function solidImage(width: number, height: number, colour: number[]): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < data.length; pixel += 4) data.set(colour, pixel);
  return { width, height, data };
}

/**
 * Default settings at 64x64, with any overrides applied.
 */
function settingsWith(overrides: Partial<SpraySettings> = {}): SpraySettings {
  return { ...DEFAULT_SETTINGS, width: 64, height: 64, ...overrides };
}

describe('buildSourceSpray', () => {
  it('writes a VTF the reader understands', () => {
    const settings = settingsWith();
    const result = buildSourceSpray([solidImage(100, 80, [255, 0, 0, 255])], settings);
    const vtf = readVtf(result.bytes);

    expect(vtf.version).toBe(2);
    expect([vtf.width, vtf.height]).toEqual([64, 64]);
    expect(vtf.format).toBe(ImageFormat.DXT1);
    expect(vtf.mips).toBe(7);
    expect(vtf.frames).toBe(1);
    expect(vtf.flags & TextureFlag.NOLOD).toBeTruthy();
    expect(result.bytes.length).toBe(estimateSize(settings, ImageFormat.DXT1, 1));

    const { data } = decodeVtfFrame(vtf, 0, 0);
    expect(data[0]).toBeGreaterThan(245);
    expect(data[1]).toBeLessThan(10);
  });

  it('picks DXT5 for transparent images and sets the alpha flag', () => {
    const result = buildSourceSpray(
      [solidImage(64, 64, [0, 0, 255, 100])],
      settingsWith(),
    );
    expect(result.format).toBe(ImageFormat.DXT5);
    expect(result.flags & TextureFlag.EIGHTBITALPHA).toBeTruthy();
  });

  it('adds NOMIP and NOLOD without mipmaps', () => {
    const result = buildSourceSpray(
      [solidImage(64, 64, [0, 0, 0, 255])],
      settingsWith({ mipmaps: false }),
    );
    expect(result.mips).toBe(1);
    expect(result.flags & TextureFlag.NOMIP).toBeTruthy();
  });

  it('stores every animation frame', () => {
    const frames = [
      solidImage(32, 32, [255, 0, 0, 255]),
      solidImage(32, 32, [0, 255, 0, 255]),
    ];
    const settings = settingsWith({ width: 32, height: 32, mipmaps: false });
    const vtf = readVtf(buildSourceSpray(frames, settings).bytes);
    expect(vtf.frames).toBe(2);
    expect(decodeVtfFrame(vtf, 1, 0).data[1]).toBeGreaterThan(245);
  });

  it('cuts straight to transparent when a fade starts and ends on one level', () => {
    const settings = settingsWith({ fade: 'out', fadeLevel: 1, fadeEndLevel: 1 });
    const vtf = readVtf(
      buildSourceSpray([solidImage(64, 64, [255, 255, 255, 255])], settings).bytes,
    );
    expect(vtf.format).toBe(ImageFormat.DXT5);
    expect(decodeVtfFrame(vtf, 0, 0).data[3]).toBe(255);
    expect(decodeVtfFrame(vtf, 0, 1).data[3]).toBe(0);
  });

  it('fades out gradually between the start and end levels', () => {
    const settings = settingsWith({
      fade: 'out',
      fadeLevel: 2,
      fadeEndLevel: 4,
      format: ImageFormat.BGRA8888,
    });
    const vtf = readVtf(
      buildSourceSpray([solidImage(64, 64, [255, 255, 255, 255])], settings).bytes,
    );
    const alphas = [0, 1, 2, 3, 4, 5].map(
      (level) => decodeVtfFrame(vtf, 0, level).data[3],
    );
    expect(alphas).toEqual([255, 255, 170, 85, 0, 0]);
  });

  it('treats a fade that ends before it starts as a cut at the start', () => {
    const settings = settingsWith({ fade: 'out', fadeLevel: 3, fadeEndLevel: 1 });
    expect([2, 3, 4].map((level) => fadeOpacity(level, settings))).toEqual([1, 0, 0]);
  });

  it('switches to a far away image from its level', () => {
    const settings = settingsWith({ fade: 'image', fadeImageLevels: [2] });
    const red = solidImage(64, 64, [255, 0, 0, 255]);
    const blue = solidImage(64, 64, [0, 0, 255, 255]);
    const vtf = readVtf(buildSourceSpray([red], settings, [blue]).bytes);
    expect(decodeVtfFrame(vtf, 0, 1).data[0]).toBeGreaterThan(200);
    expect(decodeVtfFrame(vtf, 0, 2).data[2]).toBeGreaterThan(200);
  });

  it('switches between several far away images, whatever order they were added in', () => {
    const settings = settingsWith({ fade: 'image', fadeImageLevels: [3, 1] });
    const red = solidImage(64, 64, [255, 0, 0, 255]);
    const green = solidImage(64, 64, [0, 255, 0, 255]);
    const blue = solidImage(64, 64, [0, 0, 255, 255]);
    const vtf = readVtf(buildSourceSpray([red], settings, [blue, green]).bytes);
    /**
     * The brightest channel (0 red, 1 green, 2 blue) of a mip level's first pixel.
     */
    const colourAt = (level: number): number => {
      const pixel = [...decodeVtfFrame(vtf, 0, level).data.slice(0, 3)];
      return pixel.indexOf(Math.max(...pixel));
    };
    expect([0, 1, 2, 3, 4].map(colourAt)).toEqual([0, 1, 1, 2, 2]);
  });

  it('writes resource entries for 7.3 and later', () => {
    const settings = settingsWith({
      version: 5,
      format: ImageFormat.BGRA8888,
      mipmaps: false,
    });
    const result = buildSourceSpray([solidImage(16, 16, [10, 20, 30, 255])], settings);
    const vtf = readVtf(result.bytes);
    expect(vtf.version).toBe(5);
    expect([...decodeVtfFrame(vtf, 0, 0).data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect(result.bytes.length).toBe(estimateSize(settings, ImageFormat.BGRA8888, 1));
  });

  it('removes a white halo from a cut-out when defringing', () => {
    const image: RGBAImage = {
      width: 4,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255, 255, 255, 255, 128, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    };
    const settings = settingsWith({
      width: 4,
      height: 1,
      resizeFilter: 'point',
      format: ImageFormat.BGRA8888,
      mipmaps: false,
    });
    /**
     * The edge pixel of the built spray, with or without defringing.
     */
    const edgeOf = (defringe: number): number[] => {
      const vtf = readVtf(buildSourceSpray([image], { ...settings, defringe }).bytes);
      return [...decodeVtfFrame(vtf, 0, 0).data.slice(4, 8)];
    };
    expect(edgeOf(0)).toEqual([255, 255, 255, 128]);
    expect(edgeOf(1)).toEqual([255, 0, 0, 128]);
  });

  it('keeps pixel art crisp with point sampling', () => {
    const image = solidImage(2, 2, [0, 0, 0, 255]);
    image.data.set([255, 255, 255, 255], 0);
    const settings = settingsWith({
      width: 4,
      height: 4,
      resizeFilter: 'point',
      format: ImageFormat.BGRA8888,
      mipmaps: false,
    });
    const { data } = decodeVtfFrame(
      readVtf(buildSourceSpray([image], settings).bytes),
      0,
      0,
    );
    expect(data[0]).toBe(255);
    expect(data[(1 * 4 + 1) * 4]).toBe(255);
    expect(data[(1 * 4 + 2) * 4]).toBe(0);
  });
});
