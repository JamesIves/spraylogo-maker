import type { RGBAImage } from '../image/image';

/**
 * Name the game looks for. The `{` prefix makes palette index 255 transparent.
 */
export const DECAL_NAME = '{LOGO';

/**
 * Palette index that is never drawn in `{` textures.
 */
export const TRANSPARENT_INDEX = 255;

/**
 * Mip levels every GoldSrc texture carries: full, half, quarter and eighth size.
 */
export const DECAL_MIP_LEVELS = 4;

/**
 * Largest spray area (width x height) the game accepts.
 */
export const DECAL_MAX_PIXELS = 14336;

/**
 * Longest side a spray can have.
 */
export const DECAL_MAX_SIDE = 256;

/**
 * Lump type for a texture with mip levels ("miptex") in a WAD3 file.
 */
const MIPTEX_TYPE = 0x43;

/**
 * Bytes before the mip data in a miptex lump: name, size and four mip offsets.
 */
const MIPTEX_HEADER_BYTES = 40;

/**
 * A paletted GoldSrc texture, as stored in a WAD3 file.
 */
export interface DecalTexture {
  /**
   * Texture name, such as `{LOGO`.
   */
  name: string;
  /**
   * Width in pixels.
   */
  width: number;
  /**
   * Height in pixels.
   */
  height: number;
  /**
   * Palette indices for each of the four mip levels, largest first.
   */
  mips: Uint8Array[];
  /**
   * 256 RGB entries, three bytes each.
   */
  palette: Uint8Array;
}

/**
 * Whether the game will accept a spray of this size: both sides multiples of 16
 * and no more than 256, within the overall pixel budget.
 */
export function isValidDecalSize(width: number, height: number): boolean {
  return (
    width % 16 === 0 &&
    height % 16 === 0 &&
    width > 0 &&
    height > 0 &&
    width <= DECAL_MAX_SIDE &&
    height <= DECAL_MAX_SIDE &&
    width * height <= DECAL_MAX_PIXELS
  );
}

/**
 * Writes an ASCII name into a fixed 16 byte, zero padded field.
 */
function writeName(output: Uint8Array, offset: number, name: string): void {
  for (let character = 0; character < Math.min(name.length, 15); character++) {
    output[offset + character] = name.charCodeAt(character);
  }
}

/**
 * Reads a zero terminated name from a fixed 16 byte field.
 */
function readName(bytes: Uint8Array, offset: number): string {
  const end = bytes.subarray(offset, offset + 16).indexOf(0);
  return String.fromCharCode(...bytes.subarray(offset, offset + (end < 0 ? 16 : end)));
}

/**
 * Builds a `tempdecal.wad`: a WAD3 file holding one paletted texture with its four
 * mip levels, followed by a one entry directory.
 */
export function writeDecalWad(texture: DecalTexture): Uint8Array<ArrayBuffer> {
  const pixelBytes = texture.mips.reduce((total, mip) => total + mip.length, 0);
  const unpaddedLump = MIPTEX_HEADER_BYTES + pixelBytes + 2 + 256 * 3;
  const lumpBytes = Math.ceil(unpaddedLump / 4) * 4;
  const directoryOffset = 12 + lumpBytes;
  const output = new Uint8Array(directoryOffset + 32);
  const view = new DataView(output.buffer);

  // File header.
  output.set([0x57, 0x41, 0x44, 0x33]); // "WAD3"
  view.setUint32(4, 1, true);
  view.setUint32(8, directoryOffset, true);

  // Texture lump.
  const lump = 12;
  writeName(output, lump, texture.name);
  view.setUint32(lump + 16, texture.width, true);
  view.setUint32(lump + 20, texture.height, true);
  let offset = MIPTEX_HEADER_BYTES;
  texture.mips.forEach((mip, level) => {
    view.setUint32(lump + 24 + level * 4, offset, true);
    output.set(mip, lump + offset);
    offset += mip.length;
  });
  view.setUint16(lump + offset, 256, true);
  output.set(texture.palette.subarray(0, 256 * 3), lump + offset + 2);

  // Directory entry.
  view.setUint32(directoryOffset, lump, true);
  view.setUint32(directoryOffset + 4, lumpBytes, true);
  view.setUint32(directoryOffset + 8, lumpBytes, true);
  view.setUint8(directoryOffset + 12, MIPTEX_TYPE);
  writeName(output, directoryOffset + 16, texture.name);
  return output;
}

/**
 * Reads the first texture from a WAD3 file, such as a `tempdecal.wad`.
 */
export function readDecalWad(bytes: Uint8Array): DecalTexture {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || readName(bytes, 0).slice(0, 4) !== 'WAD3') {
    throw new Error('Not a WAD3 file.');
  }
  const lumpCount = view.getUint32(4, true);
  const directoryOffset = view.getUint32(8, true);

  for (let lump = 0; lump < lumpCount; lump++) {
    const entry = directoryOffset + lump * 32;
    if (view.getUint8(entry + 12) !== MIPTEX_TYPE) continue;
    const start = view.getUint32(entry, true);
    const width = view.getUint32(start + 16, true);
    const height = view.getUint32(start + 20, true);
    const mips = Array.from({ length: DECAL_MIP_LEVELS }, (_, level) => {
      const mipStart = start + view.getUint32(start + 24 + level * 4, true);
      return bytes.slice(mipStart, mipStart + (width >> level) * (height >> level));
    });
    const lastMip =
      start + view.getUint32(start + 24 + 3 * 4, true) + (width >> 3) * (height >> 3);
    const paletteSize = view.getUint16(lastMip, true);
    const palette = new Uint8Array(256 * 3);
    palette.set(
      bytes.subarray(lastMip + 2, lastMip + 2 + Math.min(paletteSize, 256) * 3),
    );
    return { name: readName(bytes, start), width, height, mips, palette };
  }
  throw new Error('The WAD file has no textures in it.');
}

/**
 * Decodes one mip level of a paletted texture to RGBA. In `{` textures, palette
 * index 255 is transparent.
 */
export function decodeDecalMip(texture: DecalTexture, level: number): RGBAImage {
  const width = texture.width >> level;
  const height = texture.height >> level;
  const indices = texture.mips[level];
  const transparentKey = texture.name.startsWith('{');
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const entry = indices[pixel];
    if (transparentKey && entry === TRANSPARENT_INDEX) continue;
    data.set(texture.palette.subarray(entry * 3, entry * 3 + 3), pixel * 4);
    data[pixel * 4 + 3] = 255;
  }
  return { width, height, data };
}
