import { SPRAY_FRAME_MS } from '../animation/frames';
import { DECAL_MIP_LEVELS, decodeDecalMip, readDecalWad } from '../goldsrc/wad';
import type { RGBAImage } from '../image/image';
import type { SprayResult } from '../spray/settings';
import { TextureFlag } from '../vtf/format';
import { decodeVtfFrame, readVtf } from '../vtf/vtf';

/**
 * A finished spray the preview can show, whatever file type it came from.
 */
export interface PreviewTexture {
  /**
   * Width of the full size image.
   */
  width: number;
  /**
   * Height of the full size image.
   */
  height: number;
  /**
   * Number of animation frames.
   */
  frames: number;
  /**
   * Number of mip levels.
   */
  mips: number;
  /**
   * Whether the game will draw it with hard pixel edges.
   */
  pointSample: boolean;
  /**
   * Decodes one frame at one mip level.
   */
  decode: (frame: number, mip: number) => RGBAImage;
}

/**
 * Elements the preview draws into and listens to.
 */
export interface PreviewElements {
  /**
   * Where the spray is drawn.
   */
  canvas: HTMLCanvasElement;
  /**
   * Play and pause button for animations.
   */
  play: HTMLButtonElement;
  /**
   * Shows which frame is on screen.
   */
  frameLabel: HTMLElement;
  /**
   * Picks the mip level to show.
   */
  mipSlider: HTMLInputElement;
  /**
   * Shows the size of the mip level on screen.
   */
  mipLabel: HTMLOutputElement;
}

/**
 * Reads a finished spray file back so the preview shows exactly what was written.
 */
export function previewTexture(result: SprayResult): PreviewTexture {
  if (result.engine === 'goldsrc') {
    const texture = readDecalWad(result.bytes);
    return {
      width: texture.width,
      height: texture.height,
      frames: 1,
      mips: DECAL_MIP_LEVELS,
      pointSample: false,
      /**
       * GoldSrc sprays have a single frame, so only the mip level matters.
       */
      decode: (_, mip) => decodeDecalMip(texture, mip),
    };
  }
  const vtf = readVtf(result.bytes);
  return {
    width: vtf.width,
    height: vtf.height,
    frames: vtf.frames,
    mips: vtf.mips,
    pointSample: (vtf.flags & TextureFlag.POINTSAMPLE) !== 0,
    /**
     * Decodes a frame and mip level straight from the VTF.
     */
    decode: (frame, mip) => decodeVtfFrame(vtf, frame, mip),
  };
}

/**
 * Plays back the encoded spray, so compression artefacts and mipmap fades show up
 * before it goes in game.
 */
export class Preview {
  private readonly elements: PreviewElements;
  private readonly cache = new Map<string, ImageData>();
  private texture?: PreviewTexture;
  private frame = 0;
  private mip = 0;
  private timer?: number;
  private playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Hooks up the play button and mipmap slider.
   */
  constructor(elements: PreviewElements) {
    this.elements = elements;
    elements.play.addEventListener('click', () => this.setPlaying(!this.playing));
    elements.mipSlider.addEventListener('input', () => {
      this.mip = Number(elements.mipSlider.value);
      this.render();
    });
  }

  /**
   * Swaps in a newly encoded spray, keeping the current frame and mip level where
   * possible.
   */
  show(texture: PreviewTexture): void {
    const { canvas, mipSlider, play } = this.elements;
    this.texture = texture;
    this.cache.clear();
    this.frame %= texture.frames;
    this.mip = Math.min(this.mip, texture.mips - 1);
    mipSlider.max = String(texture.mips - 1);
    mipSlider.value = String(this.mip);
    mipSlider.disabled = texture.mips === 1;
    canvas.style.aspectRatio = `${texture.width} / ${texture.height}`;
    canvas.classList.toggle('is-pixelated', texture.pointSample);
    canvas.hidden = false;
    play.hidden = texture.frames === 1;
    this.setPlaying(this.playing);
    this.render();
  }

  /**
   * Starts or stops cycling through frames at the game's spray speed.
   */
  private setPlaying(playing: boolean): void {
    const { play } = this.elements;
    this.playing = playing;
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    play.classList.toggle('is-paused', !playing);
    window.clearInterval(this.timer);
    const frames = this.texture?.frames ?? 1;
    if (playing && frames > 1) {
      this.timer = window.setInterval(() => {
        this.frame = (this.frame + 1) % frames;
        this.render();
      }, SPRAY_FRAME_MS);
    }
  }

  /**
   * Draws the current frame and mip level, decoding it the first time it's shown.
   */
  private render(): void {
    const { texture } = this;
    if (!texture) return;
    const key = `${this.frame}:${this.mip}`;
    let image = this.cache.get(key);
    if (!image) {
      const { width, height, data } = texture.decode(this.frame, this.mip);
      image = new ImageData(data, width, height);
      this.cache.set(key, image);
    }

    const { canvas, frameLabel, mipLabel } = this.elements;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    canvas.getContext('2d')?.putImageData(image, 0, 0);
    frameLabel.textContent = `Frame ${this.frame + 1} of ${texture.frames}`;
    mipLabel.value = `${this.mip} (${image.width} × ${image.height})`;
  }
}
