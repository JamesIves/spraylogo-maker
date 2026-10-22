import type { Adjustments, SharpenFilter, UnsharpOptions } from '../image/filters';
import type { ResizeFilter } from '../image/resample';
import type { DxtQuality } from '../vtf/dxt';
import { TextureFlag, type ImageFormat } from '../vtf/format';

/**
 * Which game engine the spray is for. Source games use VTF files; GoldSrc games
 * (Half-Life, Counter-Strike 1.6 and friends) use a `tempdecal.wad`.
 */
export type Engine = 'source' | 'goldsrc';

/**
 * How the image fills the spray: cropped to fill it, fitted inside it, or stretched.
 */
export type FitMode = 'cover' | 'contain' | 'stretch';

/**
 * What happens at a distance: nothing, fade out, or switch to a second image.
 */
export type FadeMode = 'none' | 'out' | 'image';

/**
 * A specific VTF format, or `auto` to pick DXT1 or DXT5 from the image.
 */
export type FormatChoice = 'auto' | ImageFormat;

/**
 * Everything that controls how a spray is made.
 */
export interface SpraySettings {
  /**
   * The engine (and so the file type) to make the spray for.
   */
  engine: Engine;
  /**
   * Spray width in pixels.
   */
  width: number;
  /**
   * Spray height in pixels.
   */
  height: number;
  /**
   * How the image fills the spray.
   */
  fit: FitMode;
  /**
   * Scale on top of the fit; 1 fits exactly, higher zooms in.
   */
  zoom: number;
  /**
   * Horizontal pan from -1 (left) to 1 (right).
   */
  offsetX: number;
  /**
   * Vertical pan from -1 (top) to 1 (bottom).
   */
  offsetY: number;
  /**
   * Filter used to scale the image to the spray size.
   */
  resizeFilter: ResizeFilter;
  /**
   * VTF format to store the spray in.
   */
  format: FormatChoice;
  /**
   * Brightness, contrast and saturation changes.
   */
  adjust: Adjustments;
  /**
   * Unsharp mask amount applied to the full size image; 0 for none.
   */
  imageSharpen: number;
  /**
   * Whether to store smaller copies for viewing at a distance.
   */
  mipmaps: boolean;
  /**
   * Filter used to shrink each mip level.
   */
  mipFilter: ResizeFilter;
  /**
   * Filter applied to every mip level after the first.
   */
  mipSharpen: SharpenFilter;
  /**
   * Settings for the unsharp mask mipmap filter.
   */
  unsharp: UnsharpOptions;
  /**
   * What the spray does at a distance.
   */
  fade: FadeMode;
  /**
   * First mip level that fades.
   */
  fadeLevel: number;
  /**
   * Whether to spread edge colours under transparent pixels to stop fringes.
   */
  bleed: boolean;
  /**
   * Colour (0-1 RGB) behind transparent areas when the format has no alpha.
   */
  background: [number, number, number];
  /**
   * Alpha (0-255) below which pixels count as transparent in formats with
   * on/off transparency.
   */
  alphaThreshold: number;
  /**
   * Whether to dither formats with limited colours.
   */
  dither: boolean;
  /**
   * How hard the DXT encoder searches for good endpoints.
   */
  quality: DxtQuality;
  /**
   * User selected VTF texture flags. Alpha and mipmap flags are added automatically.
   */
  flags: number;
  /**
   * VTF minor version, so 2 means 7.2.
   */
  version: number;
  /**
   * Whether to include the small VTF thumbnail.
   */
  thumbnail: boolean;
  /**
   * Whether to compute the VTF reflectivity value from the image.
   */
  reflectivity: boolean;
}

/**
 * Settings that match VTFEdit's defaults for a still spray.
 */
export const DEFAULT_SETTINGS: SpraySettings = {
  engine: 'source',
  width: 512,
  height: 512,
  fit: 'cover',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  resizeFilter: 'catrom',
  format: 'auto',
  adjust: { brightness: 0, contrast: 1, saturation: 1 },
  imageSharpen: 0,
  mipmaps: true,
  mipFilter: 'box',
  mipSharpen: 'soft',
  unsharp: { radius: 2, amount: 0.5, threshold: 0 },
  fade: 'none',
  fadeLevel: 1,
  bleed: true,
  background: [0, 0, 0],
  alphaThreshold: 128,
  dither: true,
  quality: 'normal',
  flags: TextureFlag.CLAMPS | TextureFlag.CLAMPT | TextureFlag.NOLOD,
  version: 2,
  thumbnail: true,
  reflectivity: true,
};

/**
 * A finished spray file and what went into it.
 */
export interface SprayResult {
  /**
   * The engine the file is for.
   */
  engine: Engine;
  /**
   * The finished file: a VTF for Source, a WAD for GoldSrc.
   */
  bytes: Uint8Array<ArrayBuffer>;
  /**
   * Readable description of how the pixels are stored.
   */
  formatName: string;
  /**
   * The VTF format used, when the engine is Source.
   */
  format?: ImageFormat;
  /**
   * VTF texture flags; 0 for GoldSrc.
   */
  flags: number;
  /**
   * Number of mip levels stored.
   */
  mips: number;
  /**
   * Number of animation frames stored.
   */
  frames: number;
  /**
   * Whether the spray has transparent areas.
   */
  hasAlpha: boolean;
}
