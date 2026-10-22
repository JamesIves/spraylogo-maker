import { decompressFrames, parseGIF } from 'gifuct-js';
import { SPRAY_FRAME_MS } from '../animation/frames';
import { decodeDecalMip, readDecalWad } from '../goldsrc/wad';
import { toBytes, type RGBAImage } from '../image/image';
import { resize } from '../image/resample';
import { decodeVtfFrame, readVtf } from '../vtf/vtf';
import { decodeTga } from './tga';

/**
 * Frames decoded from whatever the user opened.
 */
export interface SourceMedia {
  /**
   * File name, or a summary when several files were opened.
   */
  name: string;
  /**
   * What sort of file it came from.
   */
  kind: 'image' | 'animation' | 'video' | 'sequence' | 'vtf' | 'wad';
  /**
   * Width of the frames in pixels.
   */
  width: number;
  /**
   * Height of the frames in pixels.
   */
  height: number;
  /**
   * The decoded frames.
   */
  frames: RGBAImage[];
  /**
   * How long each frame shows for, in milliseconds.
   */
  durations: number[];
}

/**
 * Called with a short message about decoding progress.
 */
export type ProgressReporter = (message: string) => void;

/**
 * Longest side kept for still images. Plenty for sprays, which top out at 1024.
 */
const MAX_STILL_SIDE = 2048;

/**
 * Longest side kept for animation frames, which can be numerous.
 */
const MAX_ANIMATION_SIDE = 512;

/**
 * Memory budget for all decoded animation frames combined.
 */
const MAX_ANIMATION_BYTES = 256 * 1024 * 1024;

/**
 * Most frames read from any one animation or video.
 */
const MAX_FRAMES = 600;

/**
 * Frames per second captured from videos.
 */
const VIDEO_FPS = 10;

/**
 * A single decoded frame from WebCodecs' ImageDecoder.
 */
interface DecodedImage {
  /**
   * The frame's pixels.
   */
  image: VideoFrame;
}

/**
 * An image's main track.
 */
interface ImageTrack {
  /**
   * How many frames the track has.
   */
  frameCount: number;
}

/**
 * Which frame to decode.
 */
interface DecodeOptions {
  /**
   * Zero-based frame number.
   */
  frameIndex: number;
}

/**
 * What to decode.
 */
interface ImageDecoderInit {
  /**
   * The encoded image.
   */
  data: ArrayBuffer;
  /**
   * The image's MIME type.
   */
  type: string;
}

/**
 * The parts of an image track list this decoder uses.
 */
interface ImageTrackList {
  /**
   * Resolves once the track information is available.
   */
  ready: Promise<void>;
  /**
   * The image's main track, if it has one.
   */
  selectedTrack: ImageTrack | null;
}

/**
 * The parts of WebCodecs' ImageDecoder this decoder uses. Not every browser has it.
 */
interface ImageDecoderInstance {
  /**
   * Resolves once all the data has been read.
   */
  completed: Promise<void>;
  /**
   * Tracks in the image.
   */
  tracks: ImageTrackList;
  /**
   * Decodes one frame.
   */
  decode(options: DecodeOptions): Promise<DecodedImage>;
  /**
   * Frees the decoder.
   */
  close(): void;
}

/**
 * The ImageDecoder constructor and its static helpers.
 */
interface ImageDecoderConstructor {
  /**
   * Creates a decoder for an encoded image.
   */
  new (init: ImageDecoderInit): ImageDecoderInstance;
  /**
   * Whether the browser can decode a MIME type.
   */
  isTypeSupported(type: string): Promise<boolean>;
}

/**
 * The global scope, which may or may not have ImageDecoder.
 */
interface ImageDecoderGlobal {
  /**
   * WebCodecs' ImageDecoder, where the browser has it.
   */
  ImageDecoder?: ImageDecoderConstructor;
}

const { ImageDecoder: ImageDecoderApi } = globalThis as ImageDecoderGlobal;

/**
 * A file's extension in lowercase, without the dot.
 */
function extensionOf(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Scale that keeps an animation within the side length and memory limits.
 */
function animationScale(width: number, height: number, frames: number): number {
  return Math.min(
    1,
    MAX_ANIMATION_SIDE / Math.max(width, height),
    Math.sqrt(MAX_ANIMATION_BYTES / (frames * width * height * 4)),
  );
}

/**
 * Draws anything the canvas understands into an RGBA image, optionally scaled.
 */
function drawScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
  scale = 1,
): RGBAImage {
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));
  const context = new OffscreenCanvas(scaledWidth, scaledHeight).getContext('2d', {
    willReadFrequently: true,
  })!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, scaledWidth, scaledHeight);
  const { data } = context.getImageData(0, 0, scaledWidth, scaledHeight);
  return { width: scaledWidth, height: scaledHeight, data };
}

/**
 * Shrinks an already decoded image so its longest side is at most `maxSide`.
 */
function shrink(image: RGBAImage, maxSide: number): RGBAImage {
  const scale = maxSide / Math.max(image.width, image.height);
  if (scale >= 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  return toBytes(resize(image, width, height, 'box'));
}

/**
 * Scales an image to match another's size, keeping its aspect ratio and centring it.
 */
function fitTo(image: RGBAImage, target: RGBAImage): RGBAImage {
  if (image.width === target.width && image.height === target.height) return image;
  const scale = Math.min(target.width / image.width, target.height / image.height);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const source = new OffscreenCanvas(image.width, image.height);
  source
    .getContext('2d')!
    .putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const context = new OffscreenCanvas(target.width, target.height).getContext('2d', {
    willReadFrequently: true,
  })!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    (target.width - width) / 2,
    (target.height - height) / 2,
    width,
    height,
  );
  const { data } = context.getImageData(0, 0, target.width, target.height);
  return { width: target.width, height: target.height, data };
}

/**
 * Bundles decoded frames and their timings into a {@link SourceMedia}.
 */
function toMedia(
  name: string,
  kind: SourceMedia['kind'],
  frames: RGBAImage[],
  durations: number[],
): SourceMedia {
  const [{ width, height }] = frames;
  return { name, kind, width, height, frames, durations };
}

/**
 * Decodes every frame of an existing VTF at full size.
 */
async function decodeVtfFile(file: File): Promise<SourceMedia> {
  const vtf = readVtf(new Uint8Array(await file.arrayBuffer()));
  const frames = Array.from({ length: vtf.frames }, (_, frame) =>
    decodeVtfFrame(vtf, frame, 0),
  );
  const kind = frames.length > 1 ? 'animation' : 'vtf';
  return toMedia(
    file.name,
    kind,
    frames,
    frames.map(() => SPRAY_FRAME_MS),
  );
}

/**
 * Decodes the full size image from an existing GoldSrc `tempdecal.wad`.
 */
async function decodeWadFile(file: File): Promise<SourceMedia> {
  const texture = readDecalWad(new Uint8Array(await file.arrayBuffer()));
  return toMedia(file.name, 'wad', [decodeDecalMip(texture, 0)], [SPRAY_FRAME_MS]);
}

/**
 * Decodes animated GIF, PNG, WebP or AVIF frames with the browser's ImageDecoder.
 * Returns undefined when the browser can't, or the image isn't animated.
 */
async function decodeWithImageDecoder(
  file: File,
  onProgress?: ProgressReporter,
): Promise<SourceMedia | undefined> {
  if (!ImageDecoderApi || !(await ImageDecoderApi.isTypeSupported(file.type))) {
    return undefined;
  }
  const decoder = new ImageDecoderApi({
    data: await file.arrayBuffer(),
    type: file.type,
  });
  try {
    await decoder.completed;
    await decoder.tracks.ready;
    const count = Math.min(MAX_FRAMES, decoder.tracks.selectedTrack?.frameCount ?? 1);
    if (count < 2) return undefined;

    const frames: RGBAImage[] = [];
    const durations: number[] = [];
    let scale = 1;
    for (let frame = 0; frame < count; frame++) {
      const { image } = await decoder.decode({ frameIndex: frame });
      const { displayWidth, displayHeight, duration } = image;
      if (frame === 0) scale = animationScale(displayWidth, displayHeight, count);
      frames.push(drawScaled(image, displayWidth, displayHeight, scale));
      durations.push((duration ?? 100_000) / 1000);
      image.close();
      onProgress?.(`Reading frame ${frame + 1} of ${count}`);
    }
    return toMedia(file.name, 'animation', frames, durations);
  } finally {
    decoder.close();
  }
}

/**
 * Decodes a GIF by compositing its frames by hand, for browsers without
 * ImageDecoder.
 */
async function decodeGif(
  file: File,
  onProgress?: ProgressReporter,
): Promise<SourceMedia> {
  const gif = parseGIF(await file.arrayBuffer());
  const parsed = decompressFrames(gif, true).slice(0, MAX_FRAMES);
  const { width, height } = gif.lsd;
  const scale = animationScale(width, height, parsed.length);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const patch = new OffscreenCanvas(1, 1);
  const patchContext = patch.getContext('2d')!;
  const frames: RGBAImage[] = [];
  const durations: number[] = [];
  let previous: ImageData | undefined;

  parsed.forEach((frame, index) => {
    const { left, top, width: patchWidth, height: patchHeight } = frame.dims;
    // Disposal 3 restores what was there before this frame, so keep a copy.
    if (frame.disposalType === 3) previous = context.getImageData(0, 0, width, height);

    patch.width = patchWidth;
    patch.height = patchHeight;
    const pixels = new ImageData(
      new Uint8ClampedArray(frame.patch),
      patchWidth,
      patchHeight,
    );
    patchContext.putImageData(pixels, 0, 0);
    context.drawImage(patch, left, top);

    frames.push(drawScaled(canvas, width, height, scale));
    // Browsers bump tiny GIF delays up to 100ms, so do the same.
    durations.push(frame.delay > 10 ? frame.delay : 100);
    onProgress?.(`Reading frame ${index + 1} of ${parsed.length}`);

    if (frame.disposalType === 2) context.clearRect(left, top, patchWidth, patchHeight);
    else if (frame.disposalType === 3 && previous) context.putImageData(previous, 0, 0);
  });
  return toMedia(file.name, frames.length > 1 ? 'animation' : 'image', frames, durations);
}

/**
 * Captures frames from a video by seeking through it.
 */
async function decodeVideo(
  file: File,
  onProgress?: ProgressReporter,
): Promise<SourceMedia> {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  /**
   * Resolves on the video's next `event`, or rejects if it fails to load.
   */
  const waitFor = (event: string): Promise<void> =>
    new Promise((resolve, reject) => {
      video.addEventListener(event, () => resolve(), { once: true });
      video.addEventListener(
        'error',
        () => reject(new Error("This browser can't play that video.")),
        {
          once: true,
        },
      );
    });

  try {
    const loaded = waitFor('loadeddata');
    video.src = url;
    await loaded;
    const { duration, videoWidth, videoHeight } = video;
    if (!Number.isFinite(duration)) throw new Error("Couldn't read the video's length.");

    const count = Math.max(1, Math.min(MAX_FRAMES, Math.ceil(duration * VIDEO_FPS)));
    const scale = animationScale(videoWidth, videoHeight, count);
    const frames: RGBAImage[] = [];
    for (let frame = 0; frame < count; frame++) {
      const seeked = waitFor('seeked');
      video.currentTime = Math.min(frame / VIDEO_FPS, duration - 0.001);
      await seeked;
      frames.push(drawScaled(video, videoWidth, videoHeight, scale));
      onProgress?.(`Capturing frame ${frame + 1} of ${count}`);
    }
    return toMedia(
      file.name,
      'video',
      frames,
      frames.map(() => 1000 / VIDEO_FPS),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decodes the first (or only) frame of any supported image file.
 */
export async function decodeStill(
  file: File,
  maxSide = MAX_STILL_SIDE,
): Promise<RGBAImage> {
  const extension = extensionOf(file);
  if (extension === 'tga') return shrink(decodeTga(await file.arrayBuffer()), maxSide);
  if (extension === 'vtf') return shrink((await decodeVtfFile(file)).frames[0], maxSide);
  if (extension === 'wad') return (await decodeWadFile(file)).frames[0];

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`Couldn't read ${file.name}. Try a PNG, JPG, GIF, WebP, TGA or VTF.`);
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const image = drawScaled(bitmap, bitmap.width, bitmap.height, scale);
  bitmap.close();
  return image;
}

/**
 * Turns several files into an animation, ordered by name and fitted to the first
 * frame's size.
 */
async function decodeSequence(
  files: File[],
  onProgress?: ProgressReporter,
): Promise<SourceMedia> {
  const sorted = [...files]
    .sort((first, second) =>
      first.name.localeCompare(second.name, undefined, { numeric: true }),
    )
    .slice(0, MAX_FRAMES);
  const first = await decodeStill(sorted[0], MAX_ANIMATION_SIDE);
  const frames = [first];
  for (const file of sorted.slice(1)) {
    onProgress?.(`Reading ${file.name}`);
    frames.push(fitTo(await decodeStill(file, MAX_ANIMATION_SIDE), first));
  }
  const name = `${sorted[0].name} + ${sorted.length - 1} more`;
  return toMedia(
    name,
    'sequence',
    frames,
    frames.map(() => SPRAY_FRAME_MS),
  );
}

/**
 * Turns opened files into source frames. One file can be a still image, an animated
 * GIF/PNG/WebP, a video, a VTF or a GoldSrc WAD. Several files become an animation,
 * ordered by name.
 */
export async function decodeFiles(
  files: File[],
  onProgress?: ProgressReporter,
): Promise<SourceMedia> {
  if (!files.length) throw new Error('No files selected.');
  if (files.length > 1) return decodeSequence(files, onProgress);

  const [file] = files;
  const extension = extensionOf(file);
  if (extension === 'vtf') return decodeVtfFile(file);
  if (extension === 'wad') return decodeWadFile(file);
  if (
    file.type.startsWith('video/') ||
    ['mp4', 'webm', 'mov', 'm4v'].includes(extension)
  ) {
    return decodeVideo(file, onProgress);
  }
  if (['gif', 'png', 'apng', 'webp', 'avif'].includes(extension)) {
    const animated = await decodeWithImageDecoder(file, onProgress).catch(
      () => undefined,
    );
    if (animated) return animated;
    if (extension === 'gif') return decodeGif(file, onProgress);
  }
  return toMedia(file.name, 'image', [await decodeStill(file)], [SPRAY_FRAME_MS]);
}
