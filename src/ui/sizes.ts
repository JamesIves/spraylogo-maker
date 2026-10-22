import type { Engine } from '../spray/settings';

/**
 * A labelled set of spray sizes for the size picker.
 */
interface SizeGroup {
  /**
   * Heading shown above the sizes.
   */
  label: string;
  /**
   * Width and height pairs.
   */
  sizes: [number, number][];
}

/**
 * Source sizes: powers of two, up to 512 on a side (1024 for wide or tall sprays).
 */
const SOURCE_SIZES: SizeGroup[] = [
  {
    label: 'Square',
    sizes: [
      [512, 512],
      [256, 256],
      [128, 128],
      [64, 64],
      [32, 32],
      [16, 16],
    ],
  },
  {
    label: 'Wide (2:1)',
    sizes: [
      [1024, 512],
      [512, 256],
      [256, 128],
      [128, 64],
      [64, 32],
    ],
  },
  {
    label: 'Tall (1:2)',
    sizes: [
      [512, 1024],
      [256, 512],
      [128, 256],
      [64, 128],
      [32, 64],
    ],
  },
];

/**
 * GoldSrc sizes: multiples of 16, up to 14,336 pixels in total.
 */
const GOLDSRC_SIZES: SizeGroup[] = [
  {
    label: 'Square',
    sizes: [
      [112, 112],
      [96, 96],
      [80, 80],
      [64, 64],
      [48, 48],
      [32, 32],
      [16, 16],
    ],
  },
  {
    label: 'Wide',
    sizes: [
      [128, 112],
      [144, 96],
      [176, 80],
      [224, 64],
      [256, 48],
    ],
  },
  {
    label: 'Tall',
    sizes: [
      [112, 128],
      [96, 144],
      [80, 176],
      [64, 224],
      [48, 256],
    ],
  },
];

/**
 * The size groups for an engine.
 */
export function sizeGroups(engine: Engine): SizeGroup[] {
  return engine === 'goldsrc' ? GOLDSRC_SIZES : SOURCE_SIZES;
}

/**
 * The largest square size an engine supports by default.
 */
export function largestSquare(engine: Engine): number {
  return engine === 'goldsrc' ? 112 : 512;
}

/**
 * Fills the size picker with an engine's sizes, keeping `preferred` selected when
 * it's one of them.
 */
export function fillSizeOptions(
  select: HTMLSelectElement,
  engine: Engine,
  preferred: string,
): void {
  const groups = sizeGroups(engine).map(({ label, sizes }) => {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const [width, height] of sizes) {
      const note =
        engine === 'goldsrc' && width === 64 && height === 64 ? ' (any server)' : '';
      group.append(new Option(`${width} × ${height}${note}`, `${width}x${height}`));
    }
    return group;
  });
  select.replaceChildren(...groups);
  const square = largestSquare(engine);
  select.value = select.querySelector(`option[value="${preferred}"]`)
    ? preferred
    : `${square}x${square}`;
}
