import type { RGBAImage } from '../image/image';
import type { SprayResult, SpraySettings } from '../spray/settings';
import type { WorkerRequest, WorkerResponse } from './worker';

/**
 * A spray waiting to be built, and how to report back.
 */
interface Job {
  /**
   * How to build the spray.
   */
  settings: SpraySettings;
  /**
   * Indices of the stored frames to use.
   */
  frames: number[];
  /**
   * Resolves the caller's promise with the spray, or null if a newer job replaced it.
   */
  resolve: (result: SprayResult | null) => void;
  /**
   * Rejects the caller's promise.
   */
  reject: (error: Error) => void;
}

/**
 * A job that has been sent to the worker.
 */
interface RunningJob extends Job {
  /**
   * Identifies the job in the worker's replies.
   */
  id: number;
}

/**
 * Called with how many frames of the running job are done.
 */
export type ProgressListener = (done: number, total: number) => void;

/**
 * Runs spray building in a worker so the page stays responsive. Jobs run one at a
 * time and only the newest waiting job is kept; any it replaces resolve with null.
 */
export class SprayEncoder {
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  });
  private readonly onProgress: ProgressListener;
  private running?: RunningJob;
  private waiting?: Job;
  private nextId = 0;

  /**
   * Starts the worker. `onProgress` hears about each frame as it's encoded.
   */
  public constructor(onProgress: ProgressListener = () => {}) {
    this.onProgress = onProgress;
    this.worker.addEventListener('message', ({ data }: MessageEvent<WorkerResponse>) =>
      this.handle(data),
    );
  }

  /**
   * Hands source frames to the worker. Their buffers are transferred, not copied,
   * so the frames can't be used here afterwards.
   */
  public setSources(frames: RGBAImage[]): void {
    this.post(
      { type: 'sources', frames },
      frames.map((frame) => frame.data.buffer),
    );
  }

  /**
   * Adds a far away image for fading sprays. Like source frames, its buffer is
   * transferred.
   */
  public addFarImage(image: RGBAImage): void {
    this.post({ type: 'add-far', image }, [image.data.buffer]);
  }

  /**
   * Removes the far away image at `index`.
   */
  public removeFarImage(index: number): void {
    this.post({ type: 'remove-far', index });
  }

  /**
   * Builds a spray from the given stored frames with the given settings.
   */
  public encode(settings: SpraySettings, frames: number[]): Promise<SprayResult | null> {
    return new Promise((resolve, reject) => {
      this.waiting?.resolve(null);
      this.waiting = { settings, frames, resolve, reject };
      if (!this.running) this.startNext();
    });
  }

  /**
   * Sends the waiting job to the worker, if there is one.
   */
  private startNext(): void {
    const job = this.waiting;
    this.waiting = undefined;
    if (!job) return;
    this.running = { ...job, id: this.nextId++ };
    this.post({
      type: 'encode',
      id: this.running.id,
      settings: job.settings,
      frames: job.frames,
    });
  }

  /**
   * Handles a reply for the running job: progress, a result or an error.
   */
  private handle(message: WorkerResponse): void {
    const job = this.running;
    if (!job || message.id !== job.id) return;
    if (message.type === 'progress') {
      this.onProgress(message.done, message.total);
      return;
    }
    this.running = undefined;
    if (message.type === 'done') job.resolve(message.result);
    else job.reject(new Error(message.message));
    this.startNext();
  }

  /**
   * Posts a message to the worker, transferring any buffers rather than copying them.
   */
  private post(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }
}
