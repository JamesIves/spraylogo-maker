import type { RGBAImage } from '../image/image';
import type { SprayResult, SpraySettings } from '../spray/settings';
import { buildSpray } from '../spray/spray';

/**
 * Stores the source frames in the worker.
 */
interface SourcesRequest {
  /**
   * Message type.
   */
  type: 'sources';
  /**
   * Every decoded source frame.
   */
  frames: RGBAImage[];
}

/**
 * Adds a far away image for fading sprays to the end of the list.
 */
interface AddFarImageRequest {
  /**
   * Message type.
   */
  type: 'add-far';
  /**
   * The far away image.
   */
  image: RGBAImage;
}

/**
 * Removes a far away image from the list.
 */
interface RemoveFarImageRequest {
  /**
   * Message type.
   */
  type: 'remove-far';
  /**
   * Position of the image in the list.
   */
  index: number;
}

/**
 * Builds a spray from some of the stored frames.
 */
interface EncodeRequest {
  /**
   * Message type.
   */
  type: 'encode';
  /**
   * Identifies the job in replies.
   */
  id: number;
  /**
   * How to build the spray.
   */
  settings: SpraySettings;
  /**
   * Indices of the stored frames to use, in playback order.
   */
  frames: number[];
}

/**
 * Messages the page sends to the worker.
 */
export type WorkerRequest =
  SourcesRequest | AddFarImageRequest | RemoveFarImageRequest | EncodeRequest;

/**
 * Reports how many frames of a job are done.
 */
interface ProgressResponse {
  /**
   * Message type.
   */
  type: 'progress';
  /**
   * The job this is about.
   */
  id: number;
  /**
   * Frames encoded so far.
   */
  done: number;
  /**
   * Frames in the job.
   */
  total: number;
}

/**
 * Delivers a finished spray.
 */
interface DoneResponse {
  /**
   * Message type.
   */
  type: 'done';
  /**
   * The job this is about.
   */
  id: number;
  /**
   * The finished spray.
   */
  result: SprayResult;
}

/**
 * Reports a job that failed.
 */
interface ErrorResponse {
  /**
   * Message type.
   */
  type: 'error';
  /**
   * The job this is about.
   */
  id: number;
  /**
   * What went wrong.
   */
  message: string;
}

/**
 * Messages the worker sends back to the page.
 */
export type WorkerResponse = ProgressResponse | DoneResponse | ErrorResponse;

// Frames live here so each re-encode only has to send settings.
let sources: RGBAImage[] = [];
const farImages: RGBAImage[] = [];

/**
 * Posts a response back to the page, transferring any buffers rather than copying.
 */
function reply(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

/**
 * Builds the requested spray and replies with it, or with the error.
 */
function encode({ id, settings, frames }: EncodeRequest): void {
  try {
    const result = buildSpray(
      frames.map((frame) => sources[frame]),
      settings,
      farImages,
      (done, total) => reply({ type: 'progress', id, done, total }),
    );
    reply({ type: 'done', id, result }, [result.bytes.buffer]);
  } catch (error) {
    reply({ type: 'error', id, message: (error as Error).message });
  }
}

self.addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === 'sources') sources = data.frames;
  else if (data.type === 'add-far') farImages.push(data.image);
  else if (data.type === 'remove-far') farImages.splice(data.index, 1);
  else encode(data);
});
