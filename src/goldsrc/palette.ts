import type { RGBAImage } from '../image/image';

/**
 * Bit position of red, green and blue in a colour packed as 0xRRGGBB.
 */
const CHANNEL_SHIFTS = [16, 8, 0];

/**
 * Reads one 8-bit channel (0 red, 1 green, 2 blue) from a packed colour.
 */
const channelOf = (colour: number, channel: number): number =>
  (colour >> CHANNEL_SHIFTS[channel]) & 0xff;

/**
 * The distinct visible colours in an image, with how often each appears.
 */
interface ColourCounts {
  /**
   * Distinct colours packed as 0xRRGGBB.
   */
  colours: Int32Array;
  /**
   * How many pixels use each colour.
   */
  counts: Float64Array;
}

/**
 * A group of similar colours. Median cut keeps splitting the most varied group in
 * two until there are as many groups as palette entries.
 */
interface ColourBox {
  /**
   * Indices into {@link ColourCounts} of the colours in this group.
   */
  members: number[];
  /**
   * Total squared distance of the members from their average, weighted by count.
   * Splitting the box with the biggest spread helps quality the most.
   */
  spread: number;
  /**
   * The channel with the widest variance, which the box is split along.
   */
  axis: number;
  /**
   * Average colour of the members, as 0-255 floats.
   */
  mean: [number, number, number];
}

/**
 * Options for {@link mapToPalette}.
 */
export interface MappingOptions {
  /**
   * Spread rounding errors to neighbouring pixels (Floyd-Steinberg).
   */
  dither: boolean;
  /**
   * Pixels with alpha below this become transparent.
   */
  alphaThreshold: number;
  /**
   * Palette index used for transparent pixels.
   */
  transparentIndex: number;
}

/**
 * Counts the distinct colours of the pixels at or above the alpha threshold.
 */
function countColours(image: RGBAImage, alphaThreshold: number): ColourCounts {
  const tally = new Map<number, number>();
  const { data } = image;
  for (let pixel = 0; pixel < data.length; pixel += 4) {
    if (data[pixel + 3] < alphaThreshold) continue;
    const colour = (data[pixel] << 16) | (data[pixel + 1] << 8) | data[pixel + 2];
    tally.set(colour, (tally.get(colour) ?? 0) + 1);
  }
  return {
    colours: Int32Array.from(tally.keys()),
    counts: Float64Array.from(tally.values()),
  };
}

/**
 * Works out a box's average colour, spread and widest channel.
 */
function measureBox(members: number[], { colours, counts }: ColourCounts): ColourBox {
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let total = 0;
  for (const member of members) {
    const weight = counts[member];
    total += weight;
    for (let channel = 0; channel < 3; channel++) {
      const value = channelOf(colours[member], channel);
      sums[channel] += value * weight;
      squares[channel] += value * value * weight;
    }
  }
  const mean = sums.map((sum) => sum / total) as [number, number, number];
  const variances = squares.map(
    (square, channel) => square - mean[channel] * sums[channel],
  );
  return {
    members,
    spread: variances[0] + variances[1] + variances[2],
    axis: variances.indexOf(Math.max(...variances)),
    mean,
  };
}

/**
 * Splits a box at the weighted median of its widest channel.
 */
function splitBox(box: ColourBox, counts: ColourCounts): [ColourBox, ColourBox] {
  const sorted = [...box.members].sort(
    (first, second) =>
      channelOf(counts.colours[first], box.axis) -
      channelOf(counts.colours[second], box.axis),
  );
  const half = sorted.reduce((total, member) => total + counts.counts[member], 0) / 2;
  let running = 0;
  let cut = 1;
  for (; cut < sorted.length - 1; cut++) {
    running += counts.counts[sorted[cut - 1]];
    if (running >= half) break;
  }
  return [
    measureBox(sorted.slice(0, cut), counts),
    measureBox(sorted.slice(cut), counts),
  ];
}

/**
 * Finds the palette entry closest to a colour.
 */
function nearestEntry(
  palette: Uint8Array,
  entries: number,
  red: number,
  green: number,
  blue: number,
): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let entry = 0; entry < entries; entry++) {
    const redDifference = red - palette[entry * 3];
    const greenDifference = green - palette[entry * 3 + 1];
    const blueDifference = blue - palette[entry * 3 + 2];
    const distance =
      redDifference * redDifference +
      greenDifference * greenDifference +
      blueDifference * blueDifference;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best;
}

/**
 * Picks up to `maximum` colours that best represent the image's visible pixels,
 * using median cut followed by a few rounds of k-means refinement. Returns RGB
 * triples, three bytes per entry.
 */
export function buildPalette(
  image: RGBAImage,
  maximum: number,
  alphaThreshold: number,
): Uint8Array {
  const counts = countColours(image, alphaThreshold);
  const distinct = counts.colours.length;
  if (distinct <= maximum) {
    const palette = new Uint8Array(distinct * 3);
    counts.colours.forEach((colour, entry) => {
      for (let channel = 0; channel < 3; channel++) {
        palette[entry * 3 + channel] = channelOf(colour, channel);
      }
    });
    return palette;
  }

  const boxes = [
    measureBox(
      Array.from({ length: distinct }, (_, member) => member),
      counts,
    ),
  ];
  while (boxes.length < maximum) {
    const widest = boxes.reduce(
      (best, box, index) => (box.spread > boxes[best].spread ? index : best),
      0,
    );
    if (boxes[widest].members.length < 2 || boxes[widest].spread <= 0) break;
    boxes.splice(widest, 1, ...splitBox(boxes[widest], counts));
  }

  const palette = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, entry) => palette.set(box.mean.map(Math.round), entry * 3));

  // Refine: move each entry to the average of the colours closest to it.
  for (let round = 0; round < 3; round++) {
    const sums = new Float64Array(boxes.length * 4);
    counts.colours.forEach((colour, member) => {
      const [red, green, blue] = [0, 1, 2].map((channel) => channelOf(colour, channel));
      const entry = nearestEntry(palette, boxes.length, red, green, blue);
      const weight = counts.counts[member];
      sums[entry * 4] += red * weight;
      sums[entry * 4 + 1] += green * weight;
      sums[entry * 4 + 2] += blue * weight;
      sums[entry * 4 + 3] += weight;
    });
    for (let entry = 0; entry < boxes.length; entry++) {
      const weight = sums[entry * 4 + 3];
      if (weight === 0) continue;
      for (let channel = 0; channel < 3; channel++) {
        palette[entry * 3 + channel] = Math.round(sums[entry * 4 + channel] / weight);
      }
    }
  }
  return palette;
}

/**
 * Turns an image into palette indices. Pixels below the alpha threshold get the
 * transparent index; the rest get their nearest palette entry, optionally with
 * Floyd-Steinberg dithering to soften banding.
 */
export function mapToPalette(
  image: RGBAImage,
  palette: Uint8Array,
  { dither, alphaThreshold, transparentIndex }: MappingOptions,
): Uint8Array {
  const { width, height, data } = image;
  const entries = Math.min(palette.length / 3, transparentIndex);
  const indices = new Uint8Array(width * height);
  const cache = new Map<number, number>();
  let currentErrors = new Float32Array(width * 3);
  let nextErrors = new Float32Array(width * 3);

  for (let row = 0; row < height; row++) {
    nextErrors.fill(0);
    // Alternate direction each row so errors don't drift one way.
    const leftToRight = row % 2 === 0;
    const step = leftToRight ? 1 : -1;
    for (let visited = 0; visited < width; visited++) {
      const column = leftToRight ? visited : width - 1 - visited;
      const pixel = row * width + column;
      if (data[pixel * 4 + 3] < alphaThreshold) {
        indices[pixel] = transparentIndex;
        continue;
      }

      const wanted = [0, 1, 2].map((channel) =>
        Math.min(
          255,
          Math.max(
            0,
            data[pixel * 4 + channel] +
              (dither ? currentErrors[column * 3 + channel] : 0),
          ),
        ),
      );
      const key =
        (Math.round(wanted[0]) << 16) |
        (Math.round(wanted[1]) << 8) |
        Math.round(wanted[2]);
      let entry = cache.get(key);
      if (entry === undefined) {
        entry = nearestEntry(palette, entries, wanted[0], wanted[1], wanted[2]);
        cache.set(key, entry);
      }
      indices[pixel] = entry;
      if (!dither) continue;

      for (let channel = 0; channel < 3; channel++) {
        const error = wanted[channel] - palette[entry * 3 + channel];
        const ahead = column + step;
        const behind = column - step;
        if (ahead >= 0 && ahead < width) {
          currentErrors[ahead * 3 + channel] += (error * 7) / 16;
        }
        if (behind >= 0 && behind < width) {
          nextErrors[behind * 3 + channel] += (error * 3) / 16;
        }
        nextErrors[column * 3 + channel] += (error * 5) / 16;
        if (ahead >= 0 && ahead < width) nextErrors[ahead * 3 + channel] += error / 16;
      }
    }
    [currentErrors, nextErrors] = [nextErrors, currentErrors];
  }
  return indices;
}
