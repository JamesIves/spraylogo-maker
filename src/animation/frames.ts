/**
 * Sprays animate at roughly 5 frames per second, whatever the source says.
 */
export const SPRAY_FRAME_MS = 200;

/**
 * Which source frames make it into the spray, and in what order.
 */
export interface FrameOptions {
  /**
   * `spray` resamples to the game's fixed ~5 fps; `all` keeps every source frame.
   */
  timing: 'spray' | 'all';
  /**
   * First source frame to use, counting from 1.
   */
  start: number;
  /**
   * Last source frame to use, counting from 1.
   */
  end: number;
  /**
   * Keep every nth frame.
   */
  step: number;
  /**
   * Play the frames backwards.
   */
  reverse: boolean;
  /**
   * Evenly drop frames down to this many. 0 means no limit.
   */
  maxFrames: number;
  /**
   * Source frames removed from the filmstrip.
   */
  excluded: ReadonlySet<number>;
}

/**
 * Samples whichever frame is on screen every {@link SPRAY_FRAME_MS}, so the spray
 * plays at the original speed.
 */
function retime(frames: number[], durations: number[]): number[] {
  const total = frames.reduce((sum, frame) => sum + durations[frame], 0);
  const picked: number[] = [];
  let showing = 0;
  let elapsed = 0;
  for (let time = 0; time < total; time += SPRAY_FRAME_MS) {
    while (showing < frames.length - 1 && elapsed + durations[frames[showing]] <= time) {
      elapsed += durations[frames[showing]];
      showing++;
    }
    picked.push(frames[showing]);
  }
  return picked;
}

/**
 * Evenly picks `count` entries from a list.
 */
function evenlyPick(frames: number[], count: number): number[] {
  return Array.from(
    { length: count },
    (_, slot) => frames[Math.floor((slot * frames.length) / count)],
  );
}

/**
 * Works out which source frames end up in the spray, in playback order.
 */
export function selectFrames(durations: number[], options: FrameOptions): number[] {
  const lastFrame = durations.length - 1;
  const startFrame = Math.min(lastFrame, Math.max(0, options.start - 1));
  const endFrame = Math.min(lastFrame, Math.max(startFrame, options.end - 1));
  const range: number[] = [];
  for (let frame = startFrame; frame <= endFrame; frame++) {
    if (!options.excluded.has(frame)) range.push(frame);
  }
  if (!range.length) return [];

  const timed = options.timing === 'spray' ? retime(range, durations) : range;
  const stepped = timed.filter(
    (_, position) => position % Math.max(1, options.step) === 0,
  );
  if (options.reverse) stepped.reverse();
  return options.maxFrames > 0 && stepped.length > options.maxFrames
    ? evenlyPick(stepped, options.maxFrames)
    : stepped;
}
