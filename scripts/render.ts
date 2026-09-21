/** 指定アニメーションの先頭フレームを PNG に書き出す (目視確認用) */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { AcsCharacter } from "../src/acs/reader";

const [path, animName, out] = process.argv.slice(2);
if (!path || !animName || !out) throw new Error("usage: tsx scripts/render.ts <file.acs> <animation> <out.png>");

const file = readFileSync(path);
const ch = new AcsCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const frame = ch.animations.get(animName)?.frames[0];
if (!frame) throw new Error(`アニメーション ${animName} が見つかりません`);

const W = ch.width, H = ch.height;
const px = new Uint8ClampedArray(W * H * 4);
// 背景は市松模様にして透過が分かるようにする
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const v = ((x >> 3) + (y >> 3)) & 1 ? 200 : 235;
    px.set([v, v, v, 255], (y * W + x) * 4);
  }
}
for (let i = frame.images.length - 1; i >= 0; i--) {
  const fi = frame.images[i]!;
  const img = ch.getImage(fi.imageIndex);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const dx = x + fi.x, dy = y + fi.y;
      if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
      const s = (y * img.width + x) * 4;
      if (img.rgba[s + 3] === 0) continue;
      px.set(img.rgba.subarray(s, s + 4), (dy * W + dx) * 4);
    }
  }
}

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
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
console.log(`wrote ${out} (${W}x${H})`);
