/**
 * VTF image formats. Values match Valve's `ImageFormat` enum.
 */
export const ImageFormat = {
  RGBA8888: 0,
  ABGR8888: 1,
  RGB888: 2,
  BGR888: 3,
  RGB565: 4,
  I8: 5,
  IA88: 6,
  A8: 8,
  ARGB8888: 11,
  BGRA8888: 12,
  DXT1: 13,
  DXT3: 14,
  DXT5: 15,
  BGRX8888: 16,
  BGR565: 17,
  BGRX5551: 18,
  BGRA4444: 19,
  DXT1_ONEBITALPHA: 20,
  BGRA5551: 21,
} as const;

/**
 * One of the {@link ImageFormat} values.
 */
export type ImageFormat = (typeof ImageFormat)[keyof typeof ImageFormat];

/**
 * Marks "no thumbnail" in the header's low resolution format field.
 */
export const IMAGE_FORMAT_NONE = 0xffffffff;

/**
 * Texture flags relevant to sprays, as defined by the VTF format.
 */
export const TextureFlag = {
  POINTSAMPLE: 0x1,
  TRILINEAR: 0x2,
  CLAMPS: 0x4,
  CLAMPT: 0x8,
  ANISOTROPIC: 0x10,
  HINT_DXT5: 0x20,
  NORMAL: 0x80,
  NOMIP: 0x100,
  NOLOD: 0x200,
  ONEBITALPHA: 0x1000,
  EIGHTBITALPHA: 0x2000,
  ENVMAP: 0x4000,
} as const;

/**
 * A channel stored in a packed pixel: red, green, blue, alpha, luminance, or
 * unused padding bits.
 */
export type Channel = 'r' | 'g' | 'b' | 'a' | 'l' | 'x';

/**
 * How a format stores its pixels.
 */
export interface FormatInfo {
  /**
   * Readable name, such as "DXT5".
   */
  name: string;
  /**
   * Bytes per 4x4 block for DXT formats, otherwise 0.
   */
  blockBytes: number;
  /**
   * Channels and their bit widths, from the least significant bit upward, for
   * uncompressed formats.
   */
  layout: [Channel, number][];
  /**
   * Bits of alpha per pixel, 0 when the format has none.
   */
  alphaBits: number;
}

/**
 * Format details for an uncompressed format, from its bit layout.
 */
const packed = (name: string, layout: [Channel, number][]): FormatInfo => ({
  name,
  blockBytes: 0,
  layout,
  alphaBits: layout.find(([channel]) => channel === 'a')?.[1] ?? 0,
});

/**
 * Format details for a block compressed format.
 */
const compressed = (name: string, blockBytes: number, alphaBits: number): FormatInfo => ({
  name,
  blockBytes,
  layout: [],
  alphaBits,
});

/**
 * Format details, keyed by {@link ImageFormat} value.
 */
export const FORMAT_INFO: Record<ImageFormat, FormatInfo> = {
  [ImageFormat.RGBA8888]: packed('RGBA8888', [
    ['r', 8],
    ['g', 8],
    ['b', 8],
    ['a', 8],
  ]),
  [ImageFormat.ABGR8888]: packed('ABGR8888', [
    ['a', 8],
    ['b', 8],
    ['g', 8],
    ['r', 8],
  ]),
  [ImageFormat.RGB888]: packed('RGB888', [
    ['r', 8],
    ['g', 8],
    ['b', 8],
  ]),
  [ImageFormat.BGR888]: packed('BGR888', [
    ['b', 8],
    ['g', 8],
    ['r', 8],
  ]),
  [ImageFormat.RGB565]: packed('RGB565', [
    ['r', 5],
    ['g', 6],
    ['b', 5],
  ]),
  [ImageFormat.I8]: packed('I8', [['l', 8]]),
  [ImageFormat.IA88]: packed('IA88', [
    ['l', 8],
    ['a', 8],
  ]),
  [ImageFormat.A8]: packed('A8', [['a', 8]]),
  [ImageFormat.ARGB8888]: packed('ARGB8888', [
    ['a', 8],
    ['r', 8],
    ['g', 8],
    ['b', 8],
  ]),
  [ImageFormat.BGRA8888]: packed('BGRA8888', [
    ['b', 8],
    ['g', 8],
    ['r', 8],
    ['a', 8],
  ]),
  [ImageFormat.DXT1]: compressed('DXT1', 8, 0),
  [ImageFormat.DXT3]: compressed('DXT3', 16, 8),
  [ImageFormat.DXT5]: compressed('DXT5', 16, 8),
  [ImageFormat.BGRX8888]: packed('BGRX8888', [
    ['b', 8],
    ['g', 8],
    ['r', 8],
    ['x', 8],
  ]),
  [ImageFormat.BGR565]: packed('BGR565', [
    ['b', 5],
    ['g', 6],
    ['r', 5],
  ]),
  [ImageFormat.BGRX5551]: packed('BGRX5551', [
    ['b', 5],
    ['g', 5],
    ['r', 5],
    ['x', 1],
  ]),
  [ImageFormat.BGRA4444]: packed('BGRA4444', [
    ['b', 4],
    ['g', 4],
    ['r', 4],
    ['a', 4],
  ]),
  [ImageFormat.DXT1_ONEBITALPHA]: compressed('DXT1 one-bit alpha', 8, 1),
  [ImageFormat.BGRA5551]: packed('BGRA5551', [
    ['b', 5],
    ['g', 5],
    ['r', 5],
    ['a', 1],
  ]),
};

/**
 * Looks up a format, throwing for values this tool can't read or write.
 */
export function formatInfo(format: number): FormatInfo {
  const info = FORMAT_INFO[format as ImageFormat];
  if (!info) throw new Error(`Unsupported image format ${format}.`);
  return info;
}

/**
 * Bits per pixel of an uncompressed format.
 */
export function bitsPerPixel({ layout }: FormatInfo): number {
  return layout.reduce((total, [, bits]) => total + bits, 0);
}

/**
 * Byte size of one image (a single frame at a single mip level) in a format.
 */
export function imageSize(width: number, height: number, format: ImageFormat): number {
  const info = formatInfo(format);
  if (info.blockBytes) {
    return Math.ceil(width / 4) * Math.ceil(height / 4) * info.blockBytes;
  }
  return (width * height * bitsPerPixel(info)) / 8;
}

/**
 * Number of mip levels down to 1x1, including the full size image.
 */
export function mipCount(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/**
 * Dimensions of a mip level, never smaller than 1x1.
 */
export function mipSize(width: number, height: number, level: number): [number, number] {
  return [Math.max(1, width >> level), Math.max(1, height >> level)];
}

/**
 * Byte size of one frame including all of its mip levels.
 */
export function frameSize(
  width: number,
  height: number,
  format: ImageFormat,
  mips: number,
): number {
  let total = 0;
  for (let level = 0; level < mips; level++) {
    total += imageSize(...mipSize(width, height, level), format);
  }
  return total;
}

/**
 * Header size in bytes for a minor version (7.x). Versions before 7.2 pad the header
 * to 64 bytes, 7.2 to 80, and 7.3 onwards add 8 bytes per resource entry.
 */
export function headerSize(minorVersion: number, resourceCount: number): number {
  if (minorVersion < 2) return 64;
  if (minorVersion === 2) return 80;
  return 80 + resourceCount * 8;
}

/**
 * Size of the low resolution thumbnail: the image halved until it fits in 16x16.
 */
export function thumbnailSize(width: number, height: number): [number, number] {
  const halvings = Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / 16)));
  return mipSize(width, height, halvings);
}
