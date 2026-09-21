/**
 * リボン / アドイン一覧用のアイコンを生成する。
 * ペインの吹き出し (VSTO 版 SearchBalloonForm の配色) を模した「黄色い吹き出し」:
 *   塗り #FFFF9A / 枠 #A0821E / 左下に向いたしっぽ。32px 以上は中に 3 つの点を描く。
 * 自作の図形なので、画像の権利の問題はない。`npm run icons` で public/assets/ に書き出す。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};

type Vec = [number, number];

/** 角丸四角の符号付き距離 (内側が負) */
function sdRoundBox(p: Vec, c: Vec, half: Vec, r: number): number {
  const qx = Math.abs(p[0] - c[0]) - (half[0] - r);
  const qy = Math.abs(p[1] - c[1]) - (half[1] - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 三角形の符号付き距離 (内側が負) */
function sdTriangle(p: Vec, a: Vec, b: Vec, c: Vec): number {
  const e: Vec[] = [
    [b[0] - a[0], b[1] - a[1]],
    [c[0] - b[0], c[1] - b[1]],
    [a[0] - c[0], a[1] - c[1]],
  ];
  const v: Vec[] = [a, b, c];
  let d = Infinity;
  let sign = 1;
  for (let i = 0; i < 3; i++) {
    const w: Vec = [p[0] - v[i]![0], p[1] - v[i]![1]];
    const ei = e[i]!;
    const t = Math.min(Math.max((w[0] * ei[0] + w[1] * ei[1]) / (ei[0] * ei[0] + ei[1] * ei[1]), 0), 1);
    d = Math.min(d, Math.hypot(w[0] - ei[0] * t, w[1] - ei[1] * t));
    const cross = ei[0] * w[1] - ei[1] * w[0];
    if (cross < 0) sign = -1; // 外側
  }
  // 全ての辺で cross >= 0 なら内側 (時計回り/反時計回りの両方に対応するため、逆向きも判定する)
  let allPos = true, allNeg = true;
  for (let i = 0; i < 3; i++) {
    const w: Vec = [p[0] - v[i]![0], p[1] - v[i]![1]];
    const cross = e[i]![0] * w[1] - e[i]![1] * w[0];
    if (cross < 0) allPos = false;
    if (cross > 0) allNeg = false;
  }
  void sign;
  return allPos || allNeg ? -d : d;
}

const FILL: [number, number, number] = [0xff, 0xff, 0x9a];
const LINE: [number, number, number] = [0xa0, 0x82, 0x1e];

/** 単位正方形 (0..1) 上の吹き出し。返り値は [R, G, B, A] (0..1)。 */
function shade(x: number, y: number, dots: boolean, outline: number): [number, number, number, number] {
  const body = sdRoundBox([x, y], [0.5, 0.4], [0.43, 0.31], 0.17);
  const tail = sdTriangle([x, y], [0.2, 0.62], [0.46, 0.62], [0.18, 0.92]);
  const d = Math.min(body, tail);
  if (d > 0) return [0, 0, 0, 0];
  if (dots) {
    for (const cx of [0.3, 0.5, 0.7]) {
      if (Math.hypot(x - cx, y - 0.4) <= 0.052) return [...LINE, 1].map((v, i) => (i < 3 ? (v as number) / 255 : (v as number))) as [number, number, number, number];
    }
  }
  const c = d > -outline ? LINE : FILL;
  return [c[0] / 255, c[1] / 255, c[2] / 255, 1];
}

function icon(size: number): Buffer {
  const SS = 4; // 4x4 のスーパーサンプリングでなめらかにする
  const outline = Math.max(0.05, 1.2 / size);
  const dots = size >= 32;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, dots, outline);
          r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
        }
      }
      const n = SS * SS;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      // 非乗算アルファに戻して書き込む
      raw[o] = a > 0 ? Math.round((r / a) * 255) : 0;
      raw[o + 1] = a > 0 ? Math.round((g / a) * 255) : 0;
      raw[o + 2] = a > 0 ? Math.round((b / a) * 255) : 0;
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/assets", { recursive: true });
for (const s of [16, 32, 64, 80, 128]) writeFileSync(`public/assets/icon-${s}.png`, icon(s));
console.log("icons written to public/assets");
