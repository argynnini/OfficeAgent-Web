import { readFileSync } from "node:fs";
import { AcsCharacter } from "../src/acs/reader";

const path = process.argv[2];
if (!path) throw new Error("usage: npm run dump -- <file.acs>");
const buf = readFileSync(path);
const ch = new AcsCharacter(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

console.log(`size=${ch.width}x${ch.height} transparent=${ch.transparentIndex} palette=${ch.palette.length}`);
console.log(`images=${ch.imageCount} animations=${ch.animations.size}`);
for (const [name, a] of [...ch.animations].slice(0, 5)) {
  console.log(`  ${name}: ${a.frames.length} frames, first duration=${a.frames[0]?.duration}ms`);
}

let ok = 0;
for (let i = 0; i < ch.imageCount; i++) {
  try {
    ch.getImage(i);
    ok++;
  } catch (e) {
    if (i - ok < 3) console.log(`image ${i}:`, (e as Error).message);
  }
}
console.log(`decoded ${ok}/${ch.imageCount} images`);
