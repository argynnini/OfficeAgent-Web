import { readFileSync } from "node:fs";
import { AcsCharacter } from "../src/acs/reader";
import { decodeWav } from "../src/acs/wav";

const f = readFileSync(process.argv[2]!);
const ch = new AcsCharacter(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));

let ok = 0, total = 0;
const bad: string[] = [];
for (let i = 0; ; i++) {
  const s = ch.getSound(i);
  if (!s) break;
  total++;
  const tag = new DataView(s.buffer, s.byteOffset).getUint16(20, true);
  const d = decodeWav(s);
  if (!d) { bad.push(`#${i}(tag ${tag})`); continue; }
  ok++;
  let sum = 0, peak = 0;
  for (const v of d.samples) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
  if (i < 4) console.log(`#${i} tag=${tag} ${d.sampleRate}Hz ${(d.samples.length / d.sampleRate).toFixed(2)}s rms=${Math.sqrt(sum / d.samples.length).toFixed(3)} peak=${peak.toFixed(3)}`);
}
console.log(`decoded ${ok}/${total}`, bad.length ? `unsupported: ${bad.join(" ")}` : "");
