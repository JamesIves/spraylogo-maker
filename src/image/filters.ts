import { cloneImage, type FloatImage } from './image';

/**
 * Colour adjustments applied to the full size image.
 */
export interface Adjustments {
  /**
   * Added to every colour channel, from -1 to 1.
   */
  brightness: number;
  /**
   * Multiplier around mid grey; 1 leaves the image unchanged.
   */
  contrast: number;
  /**
   * Multiplier away from grey; 0 is black and white, 1 unchanged.
   */
  saturation: number;
}

/**
 * Mipmap sharpen filters: the useful subset of VTFEdit's list. "Sharpen Soft" is
 * VTFEdit's default.
 */
export type SharpenFilter =
  | 'none'
  | 'soft'
  | 'medium'
  | 'strong'
  | 'unsharp'
  | 'smoothen'
  | 'contrastMore'
  | 'contrastLess'
  | 'lighter'
  | 'darker';

/**
 * Settings for the unsharp mask filter.
 */
export interface UnsharpOptions {
  /**
   * Blur radius in pixels.
   */
  radius: number;
  /**
   * How much of the detail to add back.
   */
  amount: number;
  /**
   * Smallest difference (0-255) that gets sharpened.
   */
  threshold: number;
}

/**
 * Clamps a value to the 0-1 range.
 */
const clampUnit = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Applies brightness, contrast and saturation in place.
 */
export function adjust(
  image: FloatImage,
  { brightness, contrast, saturation }: Adjustments,
): void {
  if (brightness === 0 && contrast === 1 && saturation === 1) return;
  const { data } = image;
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    const grey = data[pixel] * 0.299 + data[pixel + 1] * 0.587 + data[pixel + 2] * 0.114;
    for (let channel = 0; channel < 3; channel++) {
      const saturated = grey + (data[pixel + channel] - grey) * saturation;
      data[pixel + channel] = clampUnit((saturated - 0.5) * contrast + 0.5 + brightness);
    }
  }
}

/**
 * Builds a normalised Gaussian kernel for a blur of the given strength.
 */
function gaussianKernel(sigma: number): number[] {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, tap) =>
    Math.exp(-((tap - radius) ** 2) / (2 * sigma * sigma)),
  );
  const total = kernel.reduce((sum, weight) => sum + weight, 0);
  return kernel.map((weight) => weight / total);
}

/**
 * Blurs the colour channels in one direction. Running it across then down gives a
 * full Gaussian blur for much less work. Alpha is copied unchanged.
 */
function blurPass(
  image: FloatImage,
  kernel: number[],
  horizontal: boolean,
): Float32Array {
  const { width, height, data } = image;
  const radius = (kernel.length - 1) / 2;
  const output = new Float32Array(data.length);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const target = (row * width + column) * 4;
      for (let tap = -radius; tap <= radius; tap++) {
        const sampleColumn = horizontal
          ? Math.min(width - 1, Math.max(0, column + tap))
          : column;
        const sampleRow = horizontal ? row : Math.min(height - 1, Math.max(0, row + tap));
        const from = (sampleRow * width + sampleColumn) * 4;
        const weight = kernel[tap + radius];
        output[target] += data[from] * weight;
        output[target + 1] += data[from + 1] * weight;
        output[target + 2] += data[from + 2] * weight;
      }
      output[target + 3] = data[target + 3];
    }
  }
  return output;
}

/**
 * Gaussian blur of the colour channels. Alpha is left unchanged.
 */
export function blur(image: FloatImage, sigma: number): FloatImage {
  const kernel = gaussianKernel(sigma);
  const across = { ...image, data: blurPass(image, kernel, true) };
  return { ...image, data: blurPass(across, kernel, false) };
}

/**
 * Adds `amount` times the detail (the image minus a blurred copy) back on.
 */
function addDetail(
  image: FloatImage,
  blurred: FloatImage,
  amount: number,
  threshold = 0,
): void {
  const { data } = image;
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    for (let channel = pixel; channel < pixel + 3; channel++) {
      const detail = data[channel] - blurred.data[channel];
      if (Math.abs(detail) * 255 >= threshold) {
        data[channel] = clampUnit(data[channel] + detail * amount);
      }
    }
  }
}

/**
 * Runs a tone curve over every colour channel in place.
 */
function applyCurve(image: FloatImage, curve: (value: number) => number): void {
  const { data } = image;
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    for (let channel = pixel; channel < pixel + 3; channel++) {
      data[channel] = clampUnit(curve(data[channel]));
    }
  }
}

/**
 * Returns a sharpened (or otherwise filtered) copy of the image.
 */
export function sharpen(
  image: FloatImage,
  filter: SharpenFilter,
  unsharp: UnsharpOptions,
): FloatImage {
  if (filter === 'smoothen') return blur(image, 0.8);
  const output = cloneImage(image);
  switch (filter) {
    case 'soft':
      addDetail(output, blur(image, 0.8), 0.5);
      break;
    case 'medium':
      addDetail(output, blur(image, 0.8), 1);
      break;
    case 'strong':
      addDetail(output, blur(image, 0.8), 2);
      break;
    case 'unsharp':
      addDetail(
        output,
        blur(image, Math.max(0.1, unsharp.radius)),
        unsharp.amount,
        unsharp.threshold,
      );
      break;
    case 'contrastMore':
      applyCurve(output, (value) => (value - 0.5) * 1.25 + 0.5);
      break;
    case 'contrastLess':
      applyCurve(output, (value) => (value - 0.5) * 0.8 + 0.5);
      break;
    case 'lighter':
      applyCurve(output, (value) => value * 1.15);
      break;
    case 'darker':
      applyCurve(output, (value) => value * 0.85);
      break;
  }
  return output;
}

/**
 * Recolours the partly transparent pixels along a cut-out's edge with the colour of
 * the solid pixels next to them, working outwards one ring at a time for `width`
 * rings. A cut-out's soft edge still carries some of the background it was cut
 * from, which shows up as a light or dark halo; this removes it, much like
 * Photoshop's Defringe. Alpha is left unchanged.
 */
export function defringe(image: FloatImage, width = 1): void {
  const { width: columns, height: rows, data } = image;
  const solid = 254.5 / 255;
  const known = new Uint8Array(columns * rows);
  for (let pixel = 0; pixel < known.length; pixel++) {
    if (data[pixel * 4 + 3] >= solid) known[pixel] = 1;
  }

  for (let ring = 0; ring < width; ring++) {
    const updates: [number, number, number, number][] = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const pixel = row * columns + column;
        if (known[pixel] || data[pixel * 4 + 3] <= 0) continue;

        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let rowStep = -1; rowStep <= 1; rowStep++) {
          for (let columnStep = -1; columnStep <= 1; columnStep++) {
            const neighbourRow = row + rowStep;
            const neighbourColumn = column + columnStep;
            if (neighbourRow < 0 || neighbourColumn < 0) continue;
            if (neighbourRow >= rows || neighbourColumn >= columns) continue;
            const neighbour = neighbourRow * columns + neighbourColumn;
            if (!known[neighbour]) continue;
            red += data[neighbour * 4];
            green += data[neighbour * 4 + 1];
            blue += data[neighbour * 4 + 2];
            count++;
          }
        }
        if (count > 0) updates.push([pixel, red / count, green / count, blue / count]);
      }
    }
    if (!updates.length) break;
    // Apply the whole ring at once so the result doesn't depend on scan order.
    for (const [pixel, red, green, blue] of updates) {
      data[pixel * 4] = red;
      data[pixel * 4 + 1] = green;
      data[pixel * 4 + 2] = blue;
      known[pixel] = 1;
    }
  }
}

/**
 * Fills the colour of fully transparent pixels from their nearest visible
 * neighbours, one ring at a time. Stops white or black fringes appearing when the
 * game filters the texture or DXT compresses edge blocks.
 */
export function bleedEdges(image: FloatImage): void {
  const { width, height, data } = image;
  const pixelCount = width * height;
  // 0 = unknown colour, 1 = waiting in the current ring, 2 = known colour.
  const state = new Uint8Array(pixelCount);
  let ring = new Int32Array(pixelCount);
  let next = new Int32Array(pixelCount);
  let ringLength = 0;

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (data[pixel * 4 + 3] > 0) state[pixel] = 2;
  }

  /**
   * Queues the unknown neighbours of a pixel for the next ring.
   */
  const queueNeighbours = (pixel: number, queue: Int32Array, length: number): number => {
    const column = pixel % width;
    const row = (pixel - column) / width;
    for (let rowStep = -1; rowStep <= 1; rowStep++) {
      for (let columnStep = -1; columnStep <= 1; columnStep++) {
        const neighbourColumn = column + columnStep;
        const neighbourRow = row + rowStep;
        if (neighbourColumn < 0 || neighbourRow < 0) continue;
        if (neighbourColumn >= width || neighbourRow >= height) continue;
        const neighbour = neighbourRow * width + neighbourColumn;
        if (state[neighbour] === 0) {
          state[neighbour] = 1;
          queue[length++] = neighbour;
        }
      }
    }
    return length;
  };

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (state[pixel] === 2) ringLength = queueNeighbours(pixel, ring, ringLength);
  }

  const colours = new Float32Array(pixelCount * 3);
  while (ringLength > 0) {
    // Average the known neighbours of every pixel in the ring before marking any of
    // them known, so the result doesn't depend on processing order.
    for (let entry = 0; entry < ringLength; entry++) {
      const pixel = ring[entry];
      const column = pixel % width;
      const row = (pixel - column) / width;
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let rowStep = -1; rowStep <= 1; rowStep++) {
        for (let columnStep = -1; columnStep <= 1; columnStep++) {
          const neighbourColumn = column + columnStep;
          const neighbourRow = row + rowStep;
          if (neighbourColumn < 0 || neighbourRow < 0) continue;
          if (neighbourColumn >= width || neighbourRow >= height) continue;
          const neighbour = neighbourRow * width + neighbourColumn;
          if (state[neighbour] !== 2) continue;
          red += data[neighbour * 4];
          green += data[neighbour * 4 + 1];
          blue += data[neighbour * 4 + 2];
          count++;
        }
      }
      colours[entry * 3] = red / count;
      colours[entry * 3 + 1] = green / count;
      colours[entry * 3 + 2] = blue / count;
    }

    let nextLength = 0;
    for (let entry = 0; entry < ringLength; entry++) {
      const pixel = ring[entry];
      data.set(colours.subarray(entry * 3, entry * 3 + 3), pixel * 4);
      state[pixel] = 2;
    }
    for (let entry = 0; entry < ringLength; entry++) {
      nextLength = queueNeighbours(ring[entry], next, nextLength);
    }
    [ring, next] = [next, ring];
    ringLength = nextLength;
  }
}

/**
 * Composites the image over a solid colour, leaving it fully opaque.
 */
export function flatten(
  image: FloatImage,
  [red, green, blue]: [number, number, number],
): void {
  const { data } = image;
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    const alpha = data[pixel + 3];
    data[pixel] = data[pixel] * alpha + red * (1 - alpha);
    data[pixel + 1] = data[pixel + 1] * alpha + green * (1 - alpha);
    data[pixel + 2] = data[pixel + 2] * alpha + blue * (1 - alpha);
    data[pixel + 3] = 1;
  }
}

/**
 * Multiplies every pixel's alpha by `opacity` while keeping its colour, so 0 makes
 * the image fully transparent.
 */
export function scaleAlpha(image: FloatImage, opacity: number): void {
  for (let alpha = 3; alpha < image.data.length; alpha += 4) image.data[alpha] *= opacity;
}
