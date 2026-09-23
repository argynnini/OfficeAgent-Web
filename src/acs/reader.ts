import { decompress } from "./decompress";

export interface Location {
  offset: number;
  size: number;
}

export interface Overlay {
  type: number;
  replace: boolean;
  imageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameImage {
  imageIndex: number;
  x: number;
  y: number;
}

export interface Branch {
  frameIndex: number;
  probability: number;
}

export interface Frame {
  images: FrameImage[];
  soundIndex: number;
  /** 表示時間 (ms) */
  duration: number;
  /** 終了分岐先。なければ -1 */
  exitFrame: number;
  branches: Branch[];
  overlays: Overlay[];
}

export interface Animation {
  name: string;
  /** 0: 戻りアニメを使う, 1: 終了分岐を使う, 2: 戻りなし */
  transitionType: number;
  returnAnimation: string;
  frames: Frame[];
}

export interface AcsImage {
  width: number;
  height: number;
  /** RGBA (透過色は alpha=0) */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

class Cursor {
  private readonly view: DataView;
  pos: number;
  constructor(readonly buf: ArrayBuffer, pos = 0) {
    this.view = new DataView(buf);
    this.pos = pos;
  }
  u8() { return this.view.getUint8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  skip(n: number) { this.pos += n; }
  bytes(n: number) { const v = new Uint8Array(this.buf, this.pos, n); this.pos += n; return v; }
  location(): Location { return { offset: this.u32(), size: this.u32() }; }
  /** DWORD 文字数 + UTF-16LE (文字数 > 0 のとき終端 NUL 付き) */
  string(): string {
    const len = this.u32();
    if (len === 0) return "";
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.u16());
    this.skip(2);
    return s;
  }
}

const SIGNATURE = 0xabcdabc3;
const STYLE_VOICE = 1 << 5;
const STYLE_BALLOON = 1 << 9;

export class AcsCharacter {
  readonly width: number;
  readonly height: number;
  readonly transparentIndex: number;
  /** キャラクター名 (ACS に埋め込まれた名前。日本語 → 英語 → 先頭の言語の順。読めなければ undefined) */
  readonly name: string | undefined;
  /** キャラクターの紹介文 (ACS に埋め込まれていれば。同じ優先順位で選ぶ) */
  readonly description: string | undefined;
  /** [r, g, b] の配列 */
  readonly palette: [number, number, number][] = [];
  readonly animations = new Map<string, Animation>();

  private readonly imageLocations: Location[] = [];
  private readonly soundLocations: Location[] = [];
  private readonly imageCache = new Map<number, AcsImage>();

  constructor(private readonly buf: ArrayBuffer) {
    const c = new Cursor(buf);
    if (c.u32() !== SIGNATURE) throw new Error("ACS ファイルではありません");
    const charLoc = c.location();
    const animLoc = c.location();
    const imageLoc = c.location();
    const audioLoc = c.location();

    // --- キャラクター情報 ---
    c.pos = charLoc.offset;
    c.skip(4); // version
    const localizedLoc = c.location();
    c.skip(16); // GUID
    this.width = c.u16();
    this.height = c.u16();
    this.transparentIndex = c.u8();
    const style = c.u32();
    c.skip(4);
    if (style & STYLE_VOICE) {
      c.skip(32); // engine / mode GUID
      c.skip(4 + 2); // speed / pitch
      if (c.u8() !== 0) {
        c.skip(2); // lang id
        c.string(); // dialect
        c.skip(4); // gender / age
        c.string(); // style
      }
    }
    if (style & STYLE_BALLOON) {
      c.skip(2 + 12); // lines / chars per line / colors
      c.string(); // font name
      c.skip(4 + 2 + 4); // height / weight / italic / unknown など
    }
    ({ name: this.name, description: this.description } = this.readName(localizedLoc));

    const colorCount = c.u32();
    for (let i = 0; i < colorCount; i++) {
      const b = c.u8(), g = c.u8(), r = c.u8();
      c.skip(1);
      this.palette.push([r, g, b]);
    }

    // --- 画像一覧 ---
    c.pos = imageLoc.offset;
    const imageCount = c.u32();
    for (let i = 0; i < imageCount; i++) {
      this.imageLocations.push(c.location());
      c.skip(4); // checksum
    }

    // --- 効果音一覧 ---
    c.pos = audioLoc.offset;
    const soundCount = c.u32();
    for (let i = 0; i < soundCount; i++) {
      this.soundLocations.push(c.location());
      c.skip(4); // checksum
    }

    // --- アニメーション ---
    c.pos = animLoc.offset;
    const animCount = c.u32();
    const entries: { name: string; loc: Location }[] = [];
    for (let i = 0; i < animCount; i++) {
      const name = c.string();
      const loc = c.location();
      entries.push({ name, loc });
    }
    for (const e of entries) {
      this.animations.set(e.name, this.readAnimation(e.loc));
    }
  }

  /**
   * 多言語のキャラクター情報から、名前と紹介文を取り出す。
   * 名前・紹介文はそれぞれ別に、日本語 → 英語 → 先頭の言語の順で選ぶ (例えば紹介文だけ日本語が
   * 空で英語にしかない、といった ACS でも拾えるように、同じ言語の組に固定しない)
   */
  private readName(loc: Location): { name: string | undefined; description: string | undefined } {
    try {
      const c = new Cursor(this.buf, loc.offset);
      const count = c.u16();
      const names = new Map<number, string>();
      const descriptions = new Map<number, string>();
      for (let i = 0; i < count; i++) {
        const lang = c.u16();
        const name = c.string();
        const description = c.string();
        c.string(); // extra
        if (name) names.set(lang, name);
        if (description) descriptions.set(lang, description);
      }
      // lang は Windows の LANGID (下位 10bit が主言語 ID)。0x0411 (ja-JP) のようにサブ言語込みで
      // 入っていることが多いが、実ファイルでは 0x11 (主言語 ID のみ) の場合もあるため、主言語だけで比べる
      const LANG_JAPANESE = 0x11, LANG_ENGLISH = 0x9;
      const primaryLang = (lang: number) => lang & 0x3ff;
      const pick = (m: Map<number, string>) => {
        for (const [lang, v] of m) if (primaryLang(lang) === LANG_JAPANESE) return v;
        for (const [lang, v] of m) if (primaryLang(lang) === LANG_ENGLISH) return v;
        return m.values().next().value;
      };
      return { name: pick(names), description: pick(descriptions) };
    } catch {
      return { name: undefined, description: undefined };
    }
  }

  private readAnimation(loc: Location): Animation {
    const c = new Cursor(this.buf, loc.offset);
    const name = c.string();
    const transitionType = c.u8();
    const returnAnimation = c.string();
    const frameCount = c.u16();
    const frames: Frame[] = [];
    for (let f = 0; f < frameCount; f++) {
      const images: FrameImage[] = [];
      const imageCount = c.u16();
      for (let i = 0; i < imageCount; i++) {
        images.push({ imageIndex: c.u32(), x: c.i16(), y: c.i16() });
      }
      const soundIndex = c.i16();
      const duration = c.u16() * 10;
      const exitFrame = c.i16();
      const branches: Branch[] = [];
      const branchCount = c.u8();
      for (let i = 0; i < branchCount; i++) {
        branches.push({ frameIndex: c.u16(), probability: c.u16() });
      }
      const overlays: Overlay[] = [];
      const overlayCount = c.u8();
      for (let i = 0; i < overlayCount; i++) {
        const type = c.u8();
        const replace = c.u8() !== 0;
        const imageIndex = c.u16();
        c.skip(1);
        const hasRegion = c.u8() !== 0;
        const x = c.i16(), y = c.i16();
        const width = c.u16(), height = c.u16();
        if (hasRegion) c.skip(c.u32());
        overlays.push({ type, replace, imageIndex, x, y, width, height });
      }
      frames.push({ images, soundIndex, duration, exitFrame, branches, overlays });
    }
    return { name, transitionType, returnAnimation, frames };
  }

  get imageCount() {
    return this.imageLocations.length;
  }

  /** 効果音 (WAV) の生データ。存在しなければ undefined */
  getSound(index: number): Uint8Array | undefined {
    const loc = this.soundLocations[index];
    return loc && new Uint8Array(this.buf, loc.offset, loc.size);
  }

  getImage(index: number): AcsImage {
    const cached = this.imageCache.get(index);
    if (cached) return cached;

    const loc = this.imageLocations[index];
    if (!loc) throw new Error(`画像 ${index} は存在しません`);
    // 使われていない画像スロットは、ヘッダーにも満たないサイズ (実例: 1 byte) で入っていることがある。
    // そのまま読むと、次の画像のデータにはみ出して幅・高さがでたらめな値になる (巨大確保でクラッシュする)
    const MIN_HEADER_SIZE = 1 + 2 + 2 + 1 + 4; // skip(1) + width(u16) + height(u16) + compressed(u8) + dataSize(u32)
    if (loc.size < MIN_HEADER_SIZE) {
      const empty: AcsImage = { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };
      this.imageCache.set(index, empty);
      return empty;
    }
    const c = new Cursor(this.buf, loc.offset);
    c.skip(1);
    const width = c.u16();
    const height = c.u16();
    const compressed = c.u8() !== 0;
    const dataSize = c.u32();
    const raw = c.bytes(dataSize);

    const stride = (width + 3) & ~3;
    const dib = compressed ? decompress(raw, stride * height) : raw;

    // 8bit インデックス・ボトムアップ DIB → 上から下の RGBA
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * stride;
      for (let x = 0; x < width; x++) {
        const idx = dib[srcRow + x]!;
        const o = (y * width + x) * 4;
        const [r, g, b] = this.palette[idx] ?? [0, 0, 0];
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = idx === this.transparentIndex ? 0 : 255;
      }
    }
    const image = { width, height, rgba };
    this.imageCache.set(index, image);
    return image;
  }
}
