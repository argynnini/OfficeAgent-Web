import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";

const fileInput = document.getElementById("file") as HTMLInputElement;
const select = document.getElementById("animations") as HTMLSelectElement;
const playButton = document.getElementById("play") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLElement;
const canvas = document.getElementById("stage") as HTMLCanvasElement;

let player: AcsPlayer | undefined;

async function load(file: File) {
  status.textContent = `${file.name} を読み込み中...`;
  try {
    const character = new AcsCharacter(await file.arrayBuffer());
    player?.stop();
    player = new AcsPlayer(character, canvas);

    const names = [...character.animations.keys()].sort();
    select.replaceChildren(...names.map((n) => new Option(n, n)));
    select.disabled = playButton.disabled = false;

    const first = character.animations.get("RestPose") ?? character.animations.values().next().value;
    if (first?.frames[0]) player.draw(first.frames[0]);
    status.textContent = `${file.name}: ${character.width}x${character.height}, ${character.imageCount} 画像, ${names.length} アニメーション`;
  } catch (e) {
    status.textContent = `読み込みに失敗しました: ${(e as Error).message}`;
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void load(file);
});
playButton.addEventListener("click", () => void player?.play(select.value));
select.addEventListener("change", () => void player?.play(select.value));

document.body.addEventListener("dragover", (e) => e.preventDefault());
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) void load(file);
});
