import type { RGBAImage } from '../image/image';
import { decodeDxt, type DxtVariant } from './dxt';
import {
  FORMAT_INFO,
  IMAGE_FORMAT_NONE,
  ImageFormat,
  TextureFlag,
  formatInfo,
  headerSize,
  imageSize,
  mipSize,
} from './format';
import { decodePixels } from './pixels';

/**
 * Resource tag for the thumbnail in VTF 7.3+ headers.
 */
const RESOURCE_THUMBNAIL = 0x01;

/**
 * Resource tag for the main image data in VTF 7.3+ headers.
 */
const RESOURCE_IMAGE = 0x30;

/**
 * "VTF\0" read as a little-endian number.
 */
const VTF_SIGNATURE = 0x00465456;

/**
 * The small DXT1 preview stored ahead of the main image.
 */
export interface VtfThumbnail {
  /**
   * Thumbnail width in pixels.
   */
  width: number;
  /**
   * Thumbnail height in pixels.
   */
  height: number;
  /**
   * DXT1 compressed pixels.
   */
  data: Uint8Array;
}

/**
 * Everything needed to write a VTF file.
 */
export interface VtfData {
  /**
   * Minor version, so 2 means 7.2.
   */
  version: number;
  /**
   * Width of the largest mip level.
   */
  width: number;
  /**
   * Height of the largest mip level.
   */
  height: number;
  /**
   * How the image data is stored.
   */
  format: ImageFormat;
  /**
   * {@link TextureFlag} bits.
   */
  flags: number;
  /**
   * Number of animation frames.
   */
  frames: number;
  /**
   * How many mip levels are stored, counting the full size image.
   */
  mips: number;
  /**
   * Average linear colour of the texture.
   */
  reflectivity: [number, number, number];
  /**
   * Optional low resolution preview.
   */
  thumbnail?: VtfThumbnail;
  /**
   * Encoded image data, indexed as `levels[mip][frame]`.
   */
  levels: Uint8Array[][];
}

/**
 * Serialises a VTF file: the header, an optional thumbnail, then the mip levels
 * from smallest to largest with every frame of a level stored together.
 */
export function writeVtf(vtf: VtfData): Uint8Array<ArrayBuffer> {
  const resourceCount = vtf.version >= 3 ? (vtf.thumbnail ? 2 : 1) : 0;
  const header = headerSize(vtf.version, resourceCount);
  const thumbnailBytes = vtf.thumbnail?.data.length ?? 0;
  const imageBytes = vtf.levels.flat().reduce((total, data) => total + data.length, 0);

  const output = new Uint8Array(header + thumbnailBytes + imageBytes);
  const view = new DataView(output.buffer);

  view.setUint32(0, VTF_SIGNATURE, true);
  view.setUint32(4, 7, true);
  view.setUint32(8, vtf.version, true);
  view.setUint32(12, header, true);
  view.setUint16(16, vtf.width, true);
  view.setUint16(18, vtf.height, true);
  view.setUint32(20, vtf.flags, true);
  view.setUint16(24, vtf.frames, true);
  view.setUint16(26, 0, true); // First frame.
  vtf.reflectivity.forEach((value, channel) =>
    view.setFloat32(32 + channel * 4, value, true),
  );
  view.setFloat32(48, 1, true); // Bump map scale.
  view.setUint32(52, vtf.format, true);
  view.setUint8(56, vtf.mips);
  view.setUint32(57, vtf.thumbnail ? ImageFormat.DXT1 : IMAGE_FORMAT_NONE, true);
  view.setUint8(61, vtf.thumbnail?.width ?? 0);
  view.setUint8(62, vtf.thumbnail?.height ?? 0);
  if (vtf.version >= 2) view.setUint16(63, 1, true); // Depth.

  let offset = header;
  if (vtf.version >= 3) {
    view.setUint32(68, resourceCount, true);
    let entry = 80;
    if (vtf.thumbnail) {
      view.setUint8(entry, RESOURCE_THUMBNAIL);
      view.setUint32(entry + 4, offset, true);
      entry += 8;
    }
    view.setUint8(entry, RESOURCE_IMAGE);
    view.setUint32(entry + 4, offset + thumbnailBytes, true);
  }

  if (vtf.thumbnail) {
    output.set(vtf.thumbnail.data, offset);
    offset += thumbnailBytes;
  }
  for (let mip = vtf.mips - 1; mip >= 0; mip--) {
    for (const frame of vtf.levels[mip]) {
      output.set(frame, offset);
      offset += frame.length;
    }
  }
  return output;
}

/**
 * A parsed VTF header, with the raw file kept for decoding images on demand.
 */
export interface VtfFile extends Omit<VtfData, 'levels' | 'thumbnail'> {
  /**
   * Byte offset of the main image data.
   */
  imageOffset: number;
  /**
   * Cube map faces per frame; 1 for ordinary textures like sprays.
   */
  faces: number;
  /**
   * Depth slices per frame; 1 for ordinary textures like sprays.
   */
  depth: number;
  /**
   * The whole file.
   */
  bytes: Uint8Array;
}

/**
 * Parses a VTF header. Image data stays in `bytes` until it's decoded.
 */
export function readVtf(bytes: Uint8Array): VtfFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 64 || view.getUint32(0, true) !== VTF_SIGNATURE) {
    throw new Error('Not a VTF file.');
  }
  const major = view.getUint32(4, true);
  const version = view.getUint32(8, true);
  if (major !== 7 || version > 5) {
    throw new Error(`Unsupported VTF version ${major}.${version}.`);
  }

  const header = view.getUint32(12, true);
  const flags = view.getUint32(20, true);
  const firstFrame = view.getUint16(26, true);
  const format = view.getUint32(52, true) as ImageFormat;
  const thumbnailFormat = view.getUint32(57, true);
  formatInfo(format);

  // Environment maps store 6 faces, or 7 with a sphere map before version 7.5.
  let faces = 1;
  if (flags & TextureFlag.ENVMAP) faces = version < 5 && firstFrame === 0xffff ? 7 : 6;

  let imageOffset = header;
  if (version >= 3) {
    const resourceCount = view.getUint32(68, true);
    for (let resource = 0; resource < resourceCount; resource++) {
      const entry = 80 + resource * 8;
      if (view.getUint8(entry) === RESOURCE_IMAGE) {
        imageOffset = view.getUint32(entry + 4, true);
      }
    }
  } else if (thumbnailFormat !== IMAGE_FORMAT_NONE) {
    imageOffset += imageSize(
      view.getUint8(61),
      view.getUint8(62),
      thumbnailFormat as ImageFormat,
    );
  }

  return {
    version,
    width: view.getUint16(16, true),
    height: view.getUint16(18, true),
    format,
    flags,
    frames: view.getUint16(24, true),
    mips: view.getUint8(56),
    reflectivity: [
      view.getFloat32(32, true),
      view.getFloat32(36, true),
      view.getFloat32(40, true),
    ],
    imageOffset,
    faces,
    depth: version >= 2 ? view.getUint16(63, true) || 1 : 1,
    bytes,
  };
}

/**
 * DXT variant for each block compressed format.
 */
const DXT_VARIANTS: Partial<Record<ImageFormat, DxtVariant>> = {
  [ImageFormat.DXT1]: 'dxt1',
  [ImageFormat.DXT1_ONEBITALPHA]: 'dxt1a',
  [ImageFormat.DXT3]: 'dxt3',
  [ImageFormat.DXT5]: 'dxt5',
};

/**
 * The DXT variant for a format, or undefined if it isn't block compressed.
 */
export function dxtVariant(format: ImageFormat): DxtVariant | undefined {
  return DXT_VARIANTS[format];
}

/**
 * Decodes raw image data in any supported format to RGBA.
 */
export function decodeImage(
  data: Uint8Array,
  width: number,
  height: number,
  format: ImageFormat,
): Uint8ClampedArray<ArrayBuffer> {
  const variant = dxtVariant(format);
  return variant
    ? decodeDxt(data, width, height, variant)
    : decodePixels(data, width, height, format);
}

/**
 * Decodes one frame at one mip level (first face and slice) to RGBA.
 */
export function decodeVtfFrame(vtf: VtfFile, frame: number, mip: number): RGBAImage {
  const copiesPerLevel = vtf.frames * vtf.faces * vtf.depth;
  let offset = vtf.imageOffset;
  for (let level = vtf.mips - 1; level > mip; level--) {
    offset +=
      imageSize(...mipSize(vtf.width, vtf.height, level), vtf.format) * copiesPerLevel;
  }
  const [width, height] = mipSize(vtf.width, vtf.height, mip);
  const size = imageSize(width, height, vtf.format);
  offset += size * frame * vtf.faces * vtf.depth;
  if (offset + size > vtf.bytes.length) throw new Error('VTF file is truncated.');
  const data = vtf.bytes.subarray(offset, offset + size);
  return { width, height, data: decodeImage(data, width, height, vtf.format) };
}

/**
 * Readable name for a format value.
 */
export function formatName(format: ImageFormat): string {
  return FORMAT_INFO[format]?.name ?? `Format ${format}`;
}
