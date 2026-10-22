import { DECAL_MAX_PIXELS } from '../goldsrc/wad';
import { SIZE_LIMITS, type SizeLimit } from '../spray/budget';
import type { SprayResult, SpraySettings } from '../spray/settings';
import { TextureFlag } from '../vtf/format';

/**
 * Elements that make up the size meter.
 */
export interface MeterElements {
  /**
   * The meter as a whole; its `data-state` marks when the spray is too big.
   */
  meter: HTMLElement;
  /**
   * Shows how much of the limit is used.
   */
  used: HTMLElement;
  /**
   * The bar's filled part.
   */
  fill: HTMLElement;
  /**
   * Shows the GoldSrc pixel limit.
   */
  pixelLimit: HTMLElement;
}

/**
 * Names of the flags set in a VTF flags value.
 */
function flagNames(flags: number): string[] {
  return Object.entries(TextureFlag)
    .filter(([, bit]) => flags & bit)
    .map(([name]) => name.toLowerCase().replace('alpha', ' alpha'));
}

/**
 * Lists the finished file's format, size and other details under the preview.
 */
export function renderDetails(
  list: HTMLElement,
  result: SprayResult,
  settings: SpraySettings,
): void {
  const { width, height, version } = settings;
  const details: [string, string][] =
    result.engine === 'goldsrc'
      ? [
          ['Format', result.formatName],
          ['Size', `${width} × ${height}`],
          ['Mipmaps', String(result.mips)],
          ['File', 'tempdecal.wad'],
          ['File size', `${result.bytes.length.toLocaleString()} bytes`],
        ]
      : [
          ['Format', result.formatName],
          ['Size', `${width} × ${height}`],
          ['Frames', String(result.frames)],
          ['Mipmaps', result.mips > 1 ? String(result.mips) : 'None'],
          [
            'Flags',
            `0x${result.flags.toString(16).padStart(4, '0')} (${flagNames(result.flags).join(', ')})`,
          ],
          ['Version', `7.${version}`],
          ['File size', `${result.bytes.length.toLocaleString()} bytes`],
        ];
  list.replaceChildren(
    ...details.flatMap(([term, detail]) => [
      Object.assign(document.createElement('dt'), { textContent: term }),
      Object.assign(document.createElement('dd'), { textContent: detail }),
    ]),
  );
}

/**
 * Updates the size meter: bytes against the chosen limit for Source, pixels
 * against the fixed budget for GoldSrc. Returns the limit when it's exceeded.
 */
export function renderMeter(
  elements: MeterElements,
  result: SprayResult,
  settings: SpraySettings,
  limit: SizeLimit,
): string | undefined {
  const goldsrc = result.engine === 'goldsrc';
  const used = goldsrc ? settings.width * settings.height : result.bytes.length;
  const maximum = goldsrc ? DECAL_MAX_PIXELS : SIZE_LIMITS[limit];
  const ratio = used / maximum;

  elements.used.textContent = goldsrc
    ? `${used.toLocaleString()} pixels`
    : `${(used / 1024).toFixed(used < 10240 ? 1 : 0)} KB`;
  elements.pixelLimit.textContent = `${maximum.toLocaleString()} pixels`;
  elements.fill.style.inlineSize = `${Math.min(100, ratio * 100)}%`;
  elements.meter.dataset.state = ratio > 1 ? 'over' : 'ok';
  elements.meter.title = goldsrc
    ? `${result.bytes.length.toLocaleString()} bytes`
    : `${used.toLocaleString()} of ${maximum.toLocaleString()} bytes`;

  if (ratio <= 1) return undefined;
  return goldsrc ? `${maximum.toLocaleString()} pixels` : `${maximum / 1024} KB`;
}
