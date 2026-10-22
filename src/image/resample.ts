import type { FloatImage, RGBAImage } from './image';

/**
 * Resampling filters, named after their VTFEdit counterparts where one exists.
 */
export type ResizeFilter =
  'point' | 'box' | 'triangle' | 'catrom' | 'mitchell' | 'lanczos';

/**
 * An area of an image, in pixels. Can be fractional.
 */
export interface Rect {
  /**
   * Distance from the image's left edge.
   */
  left: number;
  /**
   * Distance from the image's top edge.
   */
  top: number;
  /**
   * Width of the area.
   */
  width: number;
  /**
   * Height of the area.
   */
  height: number;
}

/**
 * A filter's weighting curve and how far it reaches.
 */
interface Kernel {
  /**
   * Distance (in source pixels at 1:1) beyond which the weight is zero.
   */
  support: number;
  /**
   * Weight for a source pixel at a given distance from the sample point.
   */
  weight: (distance: number) => number;
}

/**
 * Mitchell-Netravali cubic family. `blur` 0 and `ringing` 0.5 is Catmull-Rom.
 */
function cubic(distance: number, blur: number, ringing: number): number {
  const offset = Math.abs(distance);
  if (offset < 1) {
    return (
      ((12 - 9 * blur - 6 * ringing) * offset ** 3 +
        (-18 + 12 * blur + 6 * ringing) * offset ** 2 +
        (6 - 2 * blur)) /
      6
    );
  }
  if (offset < 2) {
    return (
      ((-blur - 6 * ringing) * offset ** 3 +
        (6 * blur + 30 * ringing) * offset ** 2 +
        (-12 * blur - 48 * ringing) * offset +
        (8 * blur + 24 * ringing)) /
      6
    );
  }
  return 0;
}

/**
 * The normalised sinc function, the basis of Lanczos.
 */
const sinc = (distance: number): number =>
  distance === 0 ? 1 : Math.sin(Math.PI * distance) / (Math.PI * distance);

/**
 * Box: every source pixel within half a pixel counts equally.
 */
function box(distance: number): number {
  return distance >= -0.5 && distance < 0.5 ? 1 : 0;
}

/**
 * Triangle (bilinear): weight falls off in a straight line with distance.
 */
function triangle(distance: number): number {
  return Math.max(0, 1 - Math.abs(distance));
}

/**
 * Catmull-Rom: a sharp cubic, close to Photoshop's "Bicubic Sharper".
 */
function catmullRom(distance: number): number {
  return cubic(distance, 0, 0.5);
}

/**
 * Mitchell-Netravali: a softer cubic with less ringing.
 */
function mitchell(distance: number): number {
  return cubic(distance, 1 / 3, 1 / 3);
}

/**
 * Lanczos with three lobes: the sharpest option, with slight ringing.
 */
function lanczos(distance: number): number {
  return Math.abs(distance) < 3 ? sinc(distance) * sinc(distance / 3) : 0;
}

/**
 * Filter kernels by name. Point sampling is handled separately.
 */
const KERNELS: Record<Exclude<ResizeFilter, 'point'>, Kernel> = {
  box: { support: 0.5, weight: box },
  triangle: { support: 1, weight: triangle },
  catrom: { support: 2, weight: catmullRom },
  mitchell: { support: 2, weight: mitchell },
  lanczos: { support: 3, weight: lanczos },
};

/**
 * Which source pixels, and how much of each, feed every output pixel along one axis.
 */
interface AxisWeights {
  /**
   * Source pixels read per output pixel.
   */
  taps: number;
  /**
   * Source pixel indices, `taps` per output pixel.
   */
  sources: Int32Array;
  /**
   * Normalised weights matching `sources`.
   */
  weights: Float32Array;
}

/**
 * Works out the source pixels and weights for resampling one axis.
 */
function axisWeights(
  sourceSize: number,
  start: number,
  length: number,
  outputSize: number,
  filter: ResizeFilter,
): AxisWeights {
  const scale = length / outputSize;
  /**
   * Keeps a source index inside the image, repeating edge pixels.
   */
  const clampSource = (index: number): number =>
    Math.min(sourceSize - 1, Math.max(0, index));

  if (filter === 'point') {
    const sources = new Int32Array(outputSize);
    for (let output = 0; output < outputSize; output++) {
      sources[output] = clampSource(Math.floor(start + (output + 0.5) * scale));
    }
    return { taps: 1, sources, weights: new Float32Array(outputSize).fill(1) };
  }

  // Widen the kernel when shrinking so every source pixel contributes.
  const kernel = KERNELS[filter];
  const kernelScale = Math.max(1, scale);
  const reach = kernel.support * kernelScale;
  const taps = Math.ceil(reach * 2) + 1;
  const sources = new Int32Array(outputSize * taps);
  const weights = new Float32Array(outputSize * taps);

  for (let output = 0; output < outputSize; output++) {
    const centre = start + (output + 0.5) * scale - 0.5;
    const first = Math.ceil(centre - reach);
    let total = 0;
    for (let tap = 0; tap < taps; tap++) {
      const weight = kernel.weight((first + tap - centre) / kernelScale);
      sources[output * taps + tap] = clampSource(first + tap);
      weights[output * taps + tap] = weight;
      total += weight;
    }
    if (total === 0) {
      sources[output * taps] = clampSource(Math.round(centre));
      weights[output * taps] = total = 1;
    }
    for (let tap = 0; tap < taps; tap++) weights[output * taps + tap] /= total;
  }
  return { taps, sources, weights };
}

/**
 * Clamps a value to the 0-1 range.
 */
const clampUnit = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Resamples the `area` of `source` into a new `width` x `height` float image.
 * Works in premultiplied alpha so the colour of transparent pixels never bleeds
 * into edges. Accepts 8-bit input directly to avoid a full size float copy.
 */
export function resample(
  source: FloatImage | RGBAImage,
  area: Rect,
  width: number,
  height: number,
  filter: ResizeFilter,
): FloatImage {
  const horizontal = axisWeights(source.width, area.left, area.width, width, filter);
  const vertical = axisWeights(source.height, area.top, area.height, height, filter);
  const { data } = source;
  const scale = data instanceof Float32Array ? 1 : 1 / 255;

  // Only the rows the vertical pass reads need a horizontal pass.
  let firstRow = source.height;
  let lastRow = 0;
  vertical.sources.forEach((row, tap) => {
    if (vertical.weights[tap] === 0) return;
    firstRow = Math.min(firstRow, row);
    lastRow = Math.max(lastRow, row);
  });

  const rows = Math.max(0, lastRow - firstRow + 1);
  const intermediate = new Float32Array(rows * width * 4);
  for (let row = 0; row < rows; row++) {
    const rowStart = (firstRow + row) * source.width;
    for (let column = 0; column < width; column++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let tap = 0; tap < horizontal.taps; tap++) {
        const weight = horizontal.weights[column * horizontal.taps + tap];
        if (weight === 0) continue;
        const from = (rowStart + horizontal.sources[column * horizontal.taps + tap]) * 4;
        const coverage = weight * data[from + 3] * scale;
        red += data[from] * scale * coverage;
        green += data[from + 1] * scale * coverage;
        blue += data[from + 2] * scale * coverage;
        alpha += coverage;
      }
      const target = (row * width + column) * 4;
      intermediate[target] = red;
      intermediate[target + 1] = green;
      intermediate[target + 2] = blue;
      intermediate[target + 3] = alpha;
    }
  }

  const output = new Float32Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let tap = 0; tap < vertical.taps; tap++) {
        const weight = vertical.weights[row * vertical.taps + tap];
        if (weight === 0) continue;
        const from =
          ((vertical.sources[row * vertical.taps + tap] - firstRow) * width + column) * 4;
        red += intermediate[from] * weight;
        green += intermediate[from + 1] * weight;
        blue += intermediate[from + 2] * weight;
        alpha += intermediate[from + 3] * weight;
      }
      if (alpha > 1e-6) {
        const target = (row * width + column) * 4;
        output[target] = clampUnit(red / alpha);
        output[target + 1] = clampUnit(green / alpha);
        output[target + 2] = clampUnit(blue / alpha);
        output[target + 3] = clampUnit(alpha);
      }
    }
  }
  return { width, height, data: output };
}

/**
 * Resamples a whole image to a new size.
 */
export function resize(
  source: FloatImage | RGBAImage,
  width: number,
  height: number,
  filter: ResizeFilter,
): FloatImage {
  const area = { left: 0, top: 0, width: source.width, height: source.height };
  return resample(source, area, width, height, filter);
}
