import type { AcsCharacter, Animation, Frame } from "./reader";

/** ACS キャラクターのアニメーションを canvas に再生する */
export class AcsPlayer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new Map<number, HTMLCanvasElement>();
  private timer: number | undefined;
  /** 再生要求ごとに増やし、古い再生ループを無効化する */
  private token = 0;

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

  stop() {
    this.token++;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** アニメーションを 1 回再生する。終了 (戻りアニメ含む) で resolve */
  async play(name: string): Promise<void> {
    this.stop();
    const token = this.token;
    let current: Animation | undefined = this.character.animations.get(name);
    // 戻りアニメの連鎖は念のため上限を設ける
    for (let depth = 0; current && depth < 4; depth++) {
      await this.playFrames(current, token);
      if (token !== this.token) return;
      if (current.transitionType !== 0 || !current.returnAnimation) break;
      current = this.character.animations.get(current.returnAnimation);
    }
  }

  private playFrames(anim: Animation, token: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const step = (index: number) => {
        if (token !== this.token) return resolve();
        const frame = anim.frames[index];
        if (!frame) return resolve();
        this.draw(frame);
        const next = this.nextIndex(frame, index);
        this.timer = window.setTimeout(() => step(next), Math.max(frame.duration, 10));
      };
      step(0);
    });
  }

  /** 分岐 (確率は % 相当) があれば抽選し、なければ次のフレーム */
  private nextIndex(frame: Frame, index: number): number {
    let roll = Math.random() * 100;
    for (const b of frame.branches) {
      if (roll < b.probability) return b.frameIndex;
      roll -= b.probability;
    }
    return index + 1;
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
