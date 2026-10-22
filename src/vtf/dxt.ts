/**
 * DXT1, DXT3 and DXT5 (BC1 to BC3) block compression.
 *
 * Every 4x4 block stores two 5:6:5 colour endpoints plus a 2-bit index per pixel
 * that picks an endpoint or a blend of the two. The encoder starts with endpoints
 * on the line that best fits the block's colours, then alternates between choosing
 * indices and solving for the endpoints that best match those indices. The "best"
 * quality also nudges each endpoint channel up and down to see if that helps.
 */

/**
 * Which DXT layout to write. `dxt1a` is DXT1 with one-bit (cut-out) alpha.
 */
export type DxtVariant = 'dxt1' | 'dxt1a' | 'dxt3' | 'dxt5';

/**
 * How hard the encoder searches for good endpoints.
 */
export type DxtQuality = 'fast' | 'normal' | 'best';

/**
 * Options for {@link encodeDxt}.
 */
export interface DxtOptions {
  /**
   * Speed versus accuracy. Defaults to `normal`.
   */
  quality?: DxtQuality;
  /**
   * Alpha below this becomes fully transparent in DXT1 one-bit alpha.
   */
  alphaThreshold?: number;
}

/**
 * How much searching a quality level does.
 */
interface SearchEffort {
  /**
   * Rounds of choosing indices then refitting endpoints.
   */
  passes: number;
  /**
   * Whether to try nudging each endpoint channel afterwards.
   */
  polish: boolean;
}

/**
 * Search effort for each quality level.
 */
const SEARCH_EFFORT: Record<DxtQuality, SearchEffort> = {
  fast: { passes: 1, polish: false },
  normal: { passes: 3, polish: false },
  best: { passes: 8, polish: true },
};

/**
 * Bit position of the red, green and blue codes in a packed 5:6:5 colour.
 */
const CHANNEL_SHIFTS = [11, 5, 0];

/**
 * Largest code for the red, green and blue channels of a 5:6:5 colour.
 */
const CHANNEL_MAXIMUMS = [31, 63, 31];

/**
 * Share of the first endpoint in each palette entry, used when refitting.
 */
const FOUR_COLOUR_WEIGHTS = [1, 0, 2 / 3, 1 / 3];

/**
 * Share of the first endpoint in each palette entry in three-colour mode.
 */
const THREE_COLOUR_WEIGHTS = [1, 0, 1 / 2, 0];

/**
 * Expands a 5-bit code to 8 bits by repeating its top bits.
 */
const expandFiveBits = (code: number): number => (code << 3) | (code >> 2);

/**
 * Expands a 6-bit code to 8 bits by repeating its top bits.
 */
const expandSixBits = (code: number): number => (code << 2) | (code >> 4);

/**
 * Two thirds of the way from `far` to `near`, rounded. Shared by the encoder and
 * decoder so they always agree.
 */
const twoThirds = (near: number, far: number): number => ((2 * near + far + 1) / 3) | 0;

/**
 * Rounds and clamps a value to 0-255.
 */
const clampByte = (value: number): number =>
  value < 0 ? 0 : value > 255 ? 255 : Math.round(value);

/**
 * For each 8-bit value, the code whose expansion lands closest to it.
 */
function nearestCodeTable(levels: number, expand: (code: number) => number): Uint8Array {
  const table = new Uint8Array(256);
  for (let value = 0; value < 256; value++) {
    let bestError = Infinity;
    for (let code = 0; code < levels; code++) {
      const error = Math.abs(expand(code) - value);
      if (error < bestError) {
        bestError = error;
        table[value] = code;
      }
    }
  }
  return table;
}

const NEAREST_FIVE_BIT = nearestCodeTable(32, expandFiveBits);
const NEAREST_SIX_BIT = nearestCodeTable(64, expandSixBits);

/**
 * Expands a channel code (0 red, 1 green, 2 blue) to 8 bits.
 */
const expandCode = (code: number, channel: number): number =>
  channel === 1 ? expandSixBits(code) : expandFiveBits(code);

/**
 * The nearest code for an 8-bit channel value (0 red, 1 green, 2 blue).
 */
const nearestCode = (value: number, channel: number): number =>
  (channel === 1 ? NEAREST_SIX_BIT : NEAREST_FIVE_BIT)[clampByte(value)];

/**
 * Packs three channel codes into a 5:6:5 colour.
 */
const packCodes = (codes: number[]): number =>
  (codes[0] << 11) | (codes[1] << 5) | codes[2];

/**
 * Packs an 8-bit RGB colour into the nearest 5:6:5 colour.
 */
const packColour = (red: number, green: number, blue: number): number =>
  packCodes([nearestCode(red, 0), nearestCode(green, 1), nearestCode(blue, 2)]);

/**
 * Moves one channel of a packed colour up or down a step. Returns -1 when that
 * would go out of range.
 */
function nudgeChannel(colour: number, channel: number, step: number): number {
  const shift = CHANNEL_SHIFTS[channel];
  const code = ((colour >> shift) & CHANNEL_MAXIMUMS[channel]) + step;
  if (code < 0 || code > CHANNEL_MAXIMUMS[channel]) return -1;
  return (colour & ~(CHANNEL_MAXIMUMS[channel] << shift)) | (code << shift);
}

/**
 * Fills `palette` with the RGB values of a block's four entries: both endpoints,
 * then two thirds blends (four-colour mode) or a midpoint and transparent black
 * (three-colour mode).
 */
function buildPalette(
  first: number,
  second: number,
  fourColour: boolean,
  palette: Int32Array,
): void {
  for (let channel = 0; channel < 3; channel++) {
    const shift = CHANNEL_SHIFTS[channel];
    const start = expandCode((first >> shift) & CHANNEL_MAXIMUMS[channel], channel);
    const end = expandCode((second >> shift) & CHANNEL_MAXIMUMS[channel], channel);
    palette[channel] = start;
    palette[3 + channel] = end;
    palette[6 + channel] = fourColour ? twoThirds(start, end) : (start + end + 1) >> 1;
    palette[9 + channel] = fourColour ? twoThirds(end, start) : 0;
  }
}

// Scratch space shared by every block, so encoding doesn't allocate per block.
const blockPixels = new Uint8Array(64);
const visibleMask = new Uint8Array(16);
const paletteScratch = new Int32Array(12);
const bestIndices = new Uint8Array(16);
const trialIndices = new Uint8Array(16);
const alphaPalette = new Int32Array(8);
const alphaIndices = new Uint8Array(16);
const bestAlphaIndices = new Uint8Array(16);

/**
 * Picks the nearest palette entry for every pixel and returns the total squared
 * error of the visible ones.
 */
function assignIndices(
  pixels: Uint8Array,
  visible: Uint8Array,
  palette: Int32Array,
  entries: number,
  indices: Uint8Array,
): number {
  let totalError = 0;
  for (let pixel = 0; pixel < 16; pixel++) {
    let bestEntry = 0;
    let bestError = Infinity;
    for (let entry = 0; entry < entries; entry++) {
      let error = 0;
      for (let channel = 0; channel < 3; channel++) {
        const difference = pixels[pixel * 4 + channel] - palette[entry * 3 + channel];
        error += difference * difference;
      }
      if (error < bestError) {
        bestError = error;
        bestEntry = entry;
      }
    }
    indices[pixel] = bestEntry;
    if (visible[pixel]) totalError += bestError;
  }
  return totalError;
}

/**
 * Starting endpoints at either end of the line that best fits the visible
 * colours (their principal axis), pulled in slightly from the extremes.
 */
function axisEndpoints(pixels: Uint8Array, visible: Uint8Array): [number, number] {
  const mean = [0, 0, 0];
  let count = 0;
  for (let pixel = 0; pixel < 16; pixel++) {
    if (!visible[pixel]) continue;
    count++;
    for (let channel = 0; channel < 3; channel++) {
      mean[channel] += pixels[pixel * 4 + channel];
    }
  }
  for (let channel = 0; channel < 3; channel++) mean[channel] /= count;

  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let pixel = 0; pixel < 16; pixel++) {
    if (!visible[pixel]) continue;
    const offsets = mean.map((average, channel) => pixels[pixel * 4 + channel] - average);
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        covariance[row][column] += offsets[row] * offsets[column];
      }
    }
  }

  // Power iteration, starting from the channel that varies the most.
  const variances = covariance.map((row, channel) => row[channel]);
  let axis = [...covariance[variances.indexOf(Math.max(...variances))]];
  for (let iteration = 0; iteration < 8; iteration++) {
    const next = covariance.map(
      (row) => row[0] * axis[0] + row[1] * axis[1] + row[2] * axis[2],
    );
    const length = Math.hypot(...next);
    if (length < 1e-9) break;
    axis = next.map((value) => value / length);
  }
  if (Math.hypot(...axis) < 1e-9) axis = [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2];

  let lowest = Infinity;
  let highest = -Infinity;
  for (let pixel = 0; pixel < 16; pixel++) {
    if (!visible[pixel]) continue;
    let projection = 0;
    for (let channel = 0; channel < 3; channel++) {
      projection += (pixels[pixel * 4 + channel] - mean[channel]) * axis[channel];
    }
    lowest = Math.min(lowest, projection);
    highest = Math.max(highest, projection);
  }
  const inset = (highest - lowest) / 16;
  /**
   * The colour `distance` along the axis from the average colour.
   */
  const pointAt = (distance: number): number[] =>
    mean.map((average, channel) => average + axis[channel] * distance);
  const [startRed, startGreen, startBlue] = pointAt(highest - inset);
  const [endRed, endGreen, endBlue] = pointAt(lowest + inset);
  return [
    packColour(startRed, startGreen, startBlue),
    packColour(endRed, endGreen, endBlue),
  ];
}

/**
 * Solves (by least squares) for the endpoints that best match the current index
 * choices. Returns undefined when the indices don't pin the endpoints down.
 */
function refitEndpoints(
  pixels: Uint8Array,
  visible: Uint8Array,
  indices: Uint8Array,
  weights: number[],
): [number, number] | undefined {
  let firstSquared = 0;
  let secondSquared = 0;
  let crossTerm = 0;
  const firstSum = [0, 0, 0];
  const secondSum = [0, 0, 0];
  for (let pixel = 0; pixel < 16; pixel++) {
    if (!visible[pixel]) continue;
    const firstWeight = weights[indices[pixel]];
    const secondWeight = 1 - firstWeight;
    firstSquared += firstWeight * firstWeight;
    secondSquared += secondWeight * secondWeight;
    crossTerm += firstWeight * secondWeight;
    for (let channel = 0; channel < 3; channel++) {
      firstSum[channel] += firstWeight * pixels[pixel * 4 + channel];
      secondSum[channel] += secondWeight * pixels[pixel * 4 + channel];
    }
  }
  const determinant = firstSquared * secondSquared - crossTerm * crossTerm;
  if (Math.abs(determinant) < 1e-8) return undefined;
  const [firstRed, firstGreen, firstBlue] = firstSum.map(
    (sum, channel) =>
      (sum * secondSquared - secondSum[channel] * crossTerm) / determinant,
  );
  const [secondRed, secondGreen, secondBlue] = secondSum.map(
    (sum, channel) => (sum * firstSquared - firstSum[channel] * crossTerm) / determinant,
  );
  return [
    packColour(firstRed, firstGreen, firstBlue),
    packColour(secondRed, secondGreen, secondBlue),
  ];
}

/**
 * How to draw a block that is one solid colour.
 */
interface SolidFit {
  /**
   * The pair of 5:6:5 endpoints.
   */
  endpoints: [number, number];
  /**
   * The index every pixel uses.
   */
  index: number;
}

/**
 * The endpoints and index that best reproduce a single colour. 5:6:5 can't store
 * every colour exactly, but a two thirds blend between two nearby codes often
 * lands closer than the nearest code on its own.
 */
function solidEndpoints(colour: ArrayLike<number>): SolidFit {
  const direct: number[] = [];
  const near: number[] = [];
  const far: number[] = [];
  let directError = 0;
  let blendError = 0;

  for (let channel = 0; channel < 3; channel++) {
    const target = colour[channel];
    const code = nearestCode(target, channel);
    direct.push(code);
    directError += (expandCode(code, channel) - target) ** 2;

    let best = { near: code, far: code, error: Infinity };
    for (let nearCode = code - 1; nearCode <= code + 1; nearCode++) {
      for (let farCode = code - 2; farCode <= code + 2; farCode++) {
        const maximum = CHANNEL_MAXIMUMS[channel];
        if (nearCode < 0 || farCode < 0 || nearCode > maximum || farCode > maximum) {
          continue;
        }
        const blended = twoThirds(
          expandCode(nearCode, channel),
          expandCode(farCode, channel),
        );
        // Ties go to the closer pair, which is more forgiving of hardware rounding.
        const error = Math.abs(blended - target) + Math.abs(nearCode - farCode) / 100;
        if (error < best.error) best = { near: nearCode, far: farCode, error };
      }
    }
    near.push(best.near);
    far.push(best.far);
    blendError += Math.floor(best.error) ** 2;
  }

  return blendError < directError
    ? { endpoints: [packCodes(near), packCodes(far)], index: 2 }
    : { endpoints: [packCodes(direct), packCodes(direct)], index: 0 };
}

/**
 * Writes a colour block. The order of the endpoints tells the decoder which mode a
 * block uses, so they're swapped (and the indices remapped) where needed.
 */
function writeColourBlock(
  endpoints: [number, number],
  indices: Uint8Array,
  visible: Uint8Array,
  threeColour: boolean,
  output: Uint8Array,
  offset: number,
): void {
  let [first, second] = endpoints;
  if (threeColour) {
    if (first > second) {
      [first, second] = [second, first];
      for (let pixel = 0; pixel < 16; pixel++) {
        if (indices[pixel] < 2) indices[pixel] ^= 1;
      }
    }
    for (let pixel = 0; pixel < 16; pixel++) if (!visible[pixel]) indices[pixel] = 3;
  } else if (first < second) {
    [first, second] = [second, first];
    for (let pixel = 0; pixel < 16; pixel++) indices[pixel] ^= 1;
  } else if (first === second) {
    // Equal endpoints switch the decoder to three-colour mode, so avoid index 3.
    indices.fill(0);
  }

  let bits = 0;
  for (let pixel = 0; pixel < 16; pixel++) bits |= indices[pixel] << (pixel * 2);
  output[offset] = first & 0xff;
  output[offset + 1] = first >> 8;
  output[offset + 2] = second & 0xff;
  output[offset + 3] = second >> 8;
  output[offset + 4] = bits & 0xff;
  output[offset + 5] = (bits >>> 8) & 0xff;
  output[offset + 6] = (bits >>> 16) & 0xff;
  output[offset + 7] = (bits >>> 24) & 0xff;
}

/**
 * Encodes the 8 byte colour half of a block. Hidden pixels don't count towards the
 * fit; in three-colour mode they get DXT1's transparent index instead.
 */
function encodeColourBlock(
  pixels: Uint8Array,
  visible: Uint8Array,
  threeColour: boolean,
  effort: SearchEffort,
  output: Uint8Array,
  offset: number,
): void {
  const fourColour = !threeColour;
  const entries = fourColour ? 4 : 3;
  const weights = fourColour ? FOUR_COLOUR_WEIGHTS : THREE_COLOUR_WEIGHTS;
  const firstVisible = visible.indexOf(1);
  let endpoints: [number, number] = [0, 0];
  bestIndices.fill(0);

  const solid =
    firstVisible >= 0 &&
    visible.every(
      (shown, pixel) =>
        !shown ||
        [0, 1, 2].every(
          (channel) => pixels[pixel * 4 + channel] === pixels[firstVisible * 4 + channel],
        ),
    );

  if (solid) {
    const colour = pixels.subarray(firstVisible * 4, firstVisible * 4 + 3);
    if (fourColour) {
      const fit = solidEndpoints(colour);
      ({ endpoints } = fit);
      bestIndices.fill(fit.index);
    } else {
      const packed = packColour(colour[0], colour[1], colour[2]);
      endpoints = [packed, packed];
    }
  } else if (firstVisible >= 0) {
    endpoints = axisEndpoints(pixels, visible);
    buildPalette(...endpoints, fourColour, paletteScratch);
    let bestError = assignIndices(pixels, visible, paletteScratch, entries, bestIndices);

    /**
     * Tries a pair of endpoints and keeps them if they beat the best so far.
     */
    const tryEndpoints = (candidate: [number, number]): boolean => {
      buildPalette(...candidate, fourColour, paletteScratch);
      const error = assignIndices(pixels, visible, paletteScratch, entries, trialIndices);
      if (error >= bestError) return false;
      endpoints = candidate;
      bestError = error;
      bestIndices.set(trialIndices);
      return true;
    };

    for (let pass = 0; pass < effort.passes; pass++) {
      const refitted = refitEndpoints(pixels, visible, bestIndices, weights);
      if (!refitted || !tryEndpoints(refitted)) break;
    }

    let improved = effort.polish;
    for (let sweep = 0; sweep < 2 && improved; sweep++) {
      improved = false;
      for (const endpoint of [0, 1]) {
        for (let channel = 0; channel < 3; channel++) {
          for (const step of [-1, 1]) {
            const nudged = nudgeChannel(endpoints[endpoint], channel, step);
            if (nudged < 0) continue;
            const candidate: [number, number] =
              endpoint === 0 ? [nudged, endpoints[1]] : [endpoints[0], nudged];
            if (tryEndpoints(candidate)) improved = true;
          }
        }
      }
    }
  }

  writeColourBlock(endpoints, bestIndices, visible, threeColour, output, offset);
}

/**
 * Fills `values` with the eight alpha levels a DXT5 block can show. When the first
 * endpoint is larger there are six blended levels, otherwise four plus exact 0 and
 * 255.
 */
function buildAlphaPalette(first: number, second: number, values: Int32Array): void {
  values[0] = first;
  values[1] = second;
  if (first > second) {
    for (let step = 1; step < 7; step++) {
      values[step + 1] = (((7 - step) * first + step * second + 3) / 7) | 0;
    }
  } else {
    for (let step = 1; step < 5; step++) {
      values[step + 1] = (((5 - step) * first + step * second + 2) / 5) | 0;
    }
    values[6] = 0;
    values[7] = 255;
  }
}

/**
 * Encodes DXT5's interpolated alpha. Tries both the eight level mode and the six
 * level mode (which keeps exact 0 and 255) and keeps whichever fits better.
 */
function encodeInterpolatedAlpha(
  pixels: Uint8Array,
  output: Uint8Array,
  offset: number,
): void {
  let lowest = 255;
  let highest = 0;
  let lowestPartial = 255;
  let highestPartial = 0;
  for (let pixel = 0; pixel < 16; pixel++) {
    const alpha = pixels[pixel * 4 + 3];
    lowest = Math.min(lowest, alpha);
    highest = Math.max(highest, alpha);
    if (alpha !== 0 && alpha !== 255) {
      lowestPartial = Math.min(lowestPartial, alpha);
      highestPartial = Math.max(highestPartial, alpha);
    }
  }
  if (lowestPartial > highestPartial) lowestPartial = highestPartial = 0;

  let bestEndpoints: [number, number] = [highest, lowest];
  let bestError = Infinity;
  for (const endpoints of [
    [highest, lowest],
    [lowestPartial, highestPartial],
  ] as [number, number][]) {
    buildAlphaPalette(...endpoints, alphaPalette);
    let error = 0;
    for (let pixel = 0; pixel < 16; pixel++) {
      const alpha = pixels[pixel * 4 + 3];
      let bestLevel = 0;
      for (let level = 1; level < 8; level++) {
        if (
          Math.abs(alphaPalette[level] - alpha) <
          Math.abs(alphaPalette[bestLevel] - alpha)
        ) {
          bestLevel = level;
        }
      }
      alphaIndices[pixel] = bestLevel;
      error += (alphaPalette[bestLevel] - alpha) ** 2;
    }
    if (error < bestError) {
      bestError = error;
      bestEndpoints = endpoints;
      bestAlphaIndices.set(alphaIndices);
    }
  }

  [output[offset], output[offset + 1]] = bestEndpoints;
  for (let half = 0; half < 2; half++) {
    let bits = 0;
    for (let pixel = 0; pixel < 8; pixel++) {
      bits |= bestAlphaIndices[half * 8 + pixel] << (pixel * 3);
    }
    const start = offset + 2 + half * 3;
    output[start] = bits & 0xff;
    output[start + 1] = (bits >> 8) & 0xff;
    output[start + 2] = (bits >> 16) & 0xff;
  }
}

/**
 * Encodes DXT3's explicit 4-bit alpha, two pixels per byte.
 */
function encodeExplicitAlpha(
  pixels: Uint8Array,
  output: Uint8Array,
  offset: number,
): void {
  for (let pixel = 0; pixel < 16; pixel += 2) {
    const low = Math.round(pixels[pixel * 4 + 3] / 17);
    const high = Math.round(pixels[(pixel + 1) * 4 + 3] / 17);
    output[offset + pixel / 2] = low | (high << 4);
  }
}

/**
 * Whether a pixel counts towards the colour fit. DXT1 has no alpha, one-bit alpha
 * cuts out below the threshold, and DXT3/DXT5 skip only fully transparent pixels.
 */
function isVisible(variant: DxtVariant, alpha: number, alphaThreshold: number): boolean {
  if (variant === 'dxt1') return true;
  if (variant === 'dxt1a') return alpha >= alphaThreshold;
  return alpha > 0;
}

/**
 * Bytes per 4x4 block for a DXT variant.
 */
export const dxtBlockBytes = (variant: DxtVariant): number =>
  variant === 'dxt1' || variant === 'dxt1a' ? 8 : 16;

/**
 * Compresses RGBA pixels to DXT. Images smaller than 4x4 are padded by repeating
 * their edge pixels, so every mip level fills at least one block.
 */
export function encodeDxt(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  variant: DxtVariant,
  { quality = 'normal', alphaThreshold = 128 }: DxtOptions = {},
): Uint8Array {
  const effort = SEARCH_EFFORT[quality];
  const blockBytes = dxtBlockBytes(variant);
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const output = new Uint8Array(blocksWide * blocksHigh * blockBytes);

  for (let blockRow = 0; blockRow < blocksHigh; blockRow++) {
    for (let blockColumn = 0; blockColumn < blocksWide; blockColumn++) {
      let threeColour = false;
      for (let pixel = 0; pixel < 16; pixel++) {
        const column = Math.min(blockColumn * 4 + (pixel & 3), width - 1);
        const row = Math.min(blockRow * 4 + (pixel >> 2), height - 1);
        const source = (row * width + column) * 4;
        for (let channel = 0; channel < 4; channel++) {
          blockPixels[pixel * 4 + channel] = rgba[source + channel];
        }
        const visible = isVisible(variant, blockPixels[pixel * 4 + 3], alphaThreshold);
        visibleMask[pixel] = visible ? 1 : 0;
        if (variant === 'dxt1a' && !visible) threeColour = true;
      }
      // Fully transparent blocks still get sampled when the game filters edges,
      // so fit their colour anyway rather than letting it go black.
      if (!threeColour && !visibleMask.includes(1)) visibleMask.fill(1);

      let offset = (blockRow * blocksWide + blockColumn) * blockBytes;
      if (variant === 'dxt5') {
        encodeInterpolatedAlpha(blockPixels, output, offset);
        offset += 8;
      } else if (variant === 'dxt3') {
        encodeExplicitAlpha(blockPixels, output, offset);
        offset += 8;
      }
      encodeColourBlock(blockPixels, visibleMask, threeColour, effort, output, offset);
    }
  }
  return output;
}

/**
 * Decompresses DXT data to RGBA pixels.
 */
export function decodeDxt(
  data: Uint8Array,
  width: number,
  height: number,
  variant: DxtVariant,
): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(width * height * 4);
  const blockBytes = dxtBlockBytes(variant);
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const palette = new Int32Array(12);
  const levels = new Int32Array(8);
  const alphas = new Uint8Array(16).fill(255);

  for (let blockRow = 0; blockRow < blocksHigh; blockRow++) {
    for (let blockColumn = 0; blockColumn < blocksWide; blockColumn++) {
      let offset = (blockRow * blocksWide + blockColumn) * blockBytes;

      if (variant === 'dxt5') {
        buildAlphaPalette(data[offset], data[offset + 1], levels);
        for (let half = 0; half < 2; half++) {
          const start = offset + 2 + half * 3;
          const bits = data[start] | (data[start + 1] << 8) | (data[start + 2] << 16);
          for (let pixel = 0; pixel < 8; pixel++) {
            alphas[half * 8 + pixel] = levels[(bits >> (pixel * 3)) & 7];
          }
        }
        offset += 8;
      } else if (variant === 'dxt3') {
        for (let pixel = 0; pixel < 16; pixel++) {
          alphas[pixel] = ((data[offset + (pixel >> 1)] >> ((pixel & 1) * 4)) & 15) * 17;
        }
        offset += 8;
      }

      const first = data[offset] | (data[offset + 1] << 8);
      const second = data[offset + 2] | (data[offset + 3] << 8);
      const fourColour = first > second || variant === 'dxt3' || variant === 'dxt5';
      buildPalette(first, second, fourColour, palette);
      const bits =
        (data[offset + 4] |
          (data[offset + 5] << 8) |
          (data[offset + 6] << 16) |
          (data[offset + 7] << 24)) >>>
        0;

      for (let pixel = 0; pixel < 16; pixel++) {
        const column = blockColumn * 4 + (pixel & 3);
        const row = blockRow * 4 + (pixel >> 2);
        if (column >= width || row >= height) continue;
        const index = (bits >>> (pixel * 2)) & 3;
        const target = (row * width + column) * 4;
        output[target] = palette[index * 3];
        output[target + 1] = palette[index * 3 + 1];
        output[target + 2] = palette[index * 3 + 2];
        output[target + 3] = !fourColour && index === 3 ? 0 : alphas[pixel];
      }
    }
  }
  return output;
}
