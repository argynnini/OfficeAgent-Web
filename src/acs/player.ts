import { decodeWav } from "./wav";
import type { AcsCharacter, Animation, Frame } from "./reader";

/** ACS キャラクターのアニメーションを canvas に再生する */
export class AcsPlayer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new Map<number, HTMLCanvasElement>();
  /** 効果音を鳴らすか (ブラウザの自動再生制限のため、ユーザー操作後に有効) */
  soundEnabled = true;
  private audioCtx: AudioContext | undefined;
  private readonly buffers = new Map<number, AudioBuffer | null>();
  private timer: number | undefined;
  /** 再生要求ごとに増やし、古い再生ループを無効化する */
  private token = 0;
  /** release() が呼ばれた: 分岐で繰り返さず、終了分岐をたどって終わらせる */
  private releasing = false;
  private active = false;
  private current: string | undefined;
  /** 再生中かどうかが変わったときに呼ばれる (UI のアイコン切り替え用) */
  onPlayingChange: ((playing: boolean) => void) | undefined;
  /** 現在の play() 全体 (戻りアニメ含む) の完了 Promise */
  private running: Promise<void> | undefined;

  constructor(
    private readonly character: AcsCharacter,
    private readonly canvas: HTMLCanvasElement,
  ) {
    canvas.width = character.width;
    canvas.height = character.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d を取得できません");
    this.ctx = ctx;
  }

  /** 再生中のアニメーション名 (再生中でなければ undefined) */
  get currentAnimation(): string | undefined {
    return this.current;
  }

  /** アニメーション再生中か (stop() や再生完了で false) */
  get isPlaying(): boolean {
    return this.active;
  }

  private setActive(v: boolean) {
    if (this.active === v) return;
    this.active = v;
    this.onPlayingChange?.(v);
  }

  stop() {
    this.current = undefined;
    this.setActive(false);
    this.token++;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** アニメーションを再生する。終了 (戻りアニメ含む) か、別の再生・stop() で resolve */
  play(name: string): Promise<void> {
    this.stop();
    this.releasing = false;
    this.current = name;
    this.setActive(true);
    const token = this.token;
    const run = async () => {
      let current: Animation | undefined = this.character.animations.get(name);
      // 戻りアニメの連鎖は念のため上限を設ける
      for (let depth = 0; current && depth < 4; depth++) {
        await this.playFrames(current, token);
        if (token !== this.token) return;
        if (current.transitionType !== 0 || !current.returnAnimation) break;
        current = this.character.animations.get(current.returnAnimation);
      }
      if (token === this.token) {
        this.current = undefined;
        this.setActive(false);
      }
    };
    return (this.running = run());
  }

  /**
   * 再生中のアニメーションを自然に終わらせる。分岐による繰り返しをやめ、
   * 各フレームの終了分岐 (exit) をたどって「やめる動き」を最後まで再生する。
   * 再生中でなければすぐ resolve。stop() のように途中で切らない。
   */
  release(): Promise<void> {
    this.releasing = true;
    return this.running ?? Promise.resolve();
  }

  private playFrames(anim: Animation, token: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let releasedSteps = 0;
      const step = (index: number) => {
        if (token !== this.token) return resolve();
        const frame = anim.frames[index];
        if (!frame) return resolve();
        // 終了分岐が循環しても終わるように上限を設ける
        if (this.releasing && ++releasedSteps > anim.frames.length * 3) return resolve();
        this.draw(frame);
        if (frame.soundIndex >= 0) void this.playSound(frame.soundIndex);
        const next = this.nextIndex(frame, index);
        this.timer = window.setTimeout(() => step(next), Math.max(frame.duration, 10));
      };
      step(0);
    });
  }

  /** 分岐 (確率は % 相当) があれば抽選し、なければ次のフレーム。release 後は終了分岐を優先 */
  private nextIndex(frame: Frame, index: number): number {
    if (this.releasing) return frame.exitFrame >= 0 ? frame.exitFrame : index + 1;
    let roll = Math.random() * 100;
    for (const b of frame.branches) {
      if (roll < b.probability) return b.frameIndex;
      roll -= b.probability;
    }
    return index + 1;
  }

  private async playSound(index: number) {
    if (!this.soundEnabled) return;
    this.audioCtx ??= new AudioContext();
    const ctx = this.audioCtx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    let decoded = this.buffers.get(index);
    if (decoded === undefined) {
      const wav = this.character.getSound(index);
      const pcm = wav && decodeWav(wav);
      if (pcm) {
        decoded = ctx.createBuffer(1, pcm.samples.length, pcm.sampleRate);
        decoded.copyToChannel(pcm.samples, 0);
      }
      this.buffers.set(index, decoded ?? null);
    }
    if (!decoded) return;
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(ctx.destination);
    src.start();
  }

  private sprite(index: number): HTMLCanvasElement {
    let c = this.sprites.get(index);
    if (c) return c;
    const img = this.character.getImage(index);
    c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
    this.sprites.set(index, c);
    return c;
  }

  draw(frame: Frame) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // 先頭の画像が最前面
    for (let i = frame.images.length - 1; i >= 0; i--) {
      const fi = frame.images[i]!;
      this.ctx.drawImage(this.sprite(fi.imageIndex), fi.x, fi.y);
    }
  }
}
