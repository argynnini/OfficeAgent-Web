import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { isIdleName } from "./idle";
import { loadCharacter, saveCharacter } from "./store";

const fileInput = document.getElementById("file") as HTMLInputElement;
const pickButton = document.getElementById("pick") as HTMLButtonElement;
const emptyButton = document.getElementById("empty") as HTMLButtonElement;
const playButton = document.getElementById("play") as HTMLButtonElement;
const soundButton = document.getElementById("sound") as HTMLButtonElement;
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const balloon = document.getElementById("balloon") as HTMLElement;
const nameLabel = document.getElementById("name") as HTMLElement;
const animsPanel = document.getElementById("anims") as HTMLElement;
const filter = document.getElementById("filter") as HTMLInputElement;
const animList = document.getElementById("anim-list") as HTMLElement;

/** 表示倍率の上限。ドット絵なので整数倍で拡大する (image-rendering: pixelated) */
const MAX_SCALE = 2;
/** ステージの左右の余白 (拡大しても、小さい画面ではみ出さないように差し引く) */
const STAGE_PADDING = 32;

let player: AcsPlayer | undefined;
let character: AcsCharacter | undefined;
let names: string[] = [];
/** 最後に選んだアニメーション (再生ボタンで繰り返す) */
let selected: string | undefined;

function say(html: string, error = false) {
  balloon.innerHTML = html;
  balloon.dataset.error = String(error);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 画面幅に収まる整数倍で表示する */
function fitCanvas() {
  if (!character) return;
  const room = (canvas.parentElement?.clientWidth ?? character.width) - STAGE_PADDING;
  const scale = Math.max(1, Math.min(MAX_SCALE, Math.floor(room / character.width)));
  canvas.style.width = `${character.width * scale}px`;
}

function renderList() {
  const q = filter.value.trim().toLowerCase();
  const shown = q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
  if (shown.length === 0) {
    const p = document.createElement("div");
    p.className = "anim-empty";
    p.textContent = "一致するアニメーションはありません";
    animList.replaceChildren(p);
    return;
  }
  animList.replaceChildren(
    ...shown.map((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "anim";
      b.role = "listitem";
      b.textContent = n;
      b.dataset.name = n;
      b.setAttribute("aria-current", String(n === player?.currentAnimation));
      return b;
    }),
  );
}

function markCurrent() {
  const current = player?.currentAnimation;
  animList.querySelectorAll<HTMLButtonElement>(".anim").forEach((b) => {
    b.setAttribute("aria-current", String(b.dataset.name === current));
  });
}

function play(name: string) {
  if (!player) return;
  selected = name;
  player.unlockAudio();
  void player.play(name);
}

async function open(fileName: string, data: ArrayBuffer, save: boolean) {
  say(`<b>${escape(fileName)}</b> を読み込み中…`);
  try {
    const next = new AcsCharacter(data);
    player?.stop();
    character = next;
    player = new AcsPlayer(next, canvas);
    player.soundEnabled = soundButton.getAttribute("aria-pressed") === "true";
    player.onPlayingChange = (playing) => {
      playButton.dataset.playing = String(playing);
      playButton.title = playButton.ariaLabel = playing ? "停止" : "再生";
      markCurrent();
    };

    names = [...next.animations.keys()].sort((a, b) => a.localeCompare(b));
    filter.value = "";
    renderList();

    canvas.hidden = false;
    emptyButton.hidden = true;
    animsPanel.hidden = false;
    playButton.disabled = false;
    fitCanvas();

    const title = next.name ?? fileName.replace(/\.acs$/i, "");
    nameLabel.innerHTML = `<strong>${escape(title)}</strong> · ${next.width}×${next.height} · ${names.length} アニメーション`;
    nameLabel.title = fileName;
    say(
      next.description
        ? escape(next.description)
        : `<b>${escape(title)}</b> です。下の一覧からアニメーションを選んでください。`,
    );

    if (save) await saveCharacter(fileName, data).catch(() => undefined);

    // 登場アニメがあれば再生し、なければ待機姿勢を描く
    const entrance = ["Greeting", "Show"].find((n) => next.animations.has(n));
    if (entrance) {
      selected = entrance;
      void player.play(entrance);
    } else {
      const rest = next.animations.get("RestPose") ?? next.animations.values().next().value;
      if (rest?.frames[0]) player.draw(rest.frames[0]);
    }
  } catch (e) {
    say(`読み込みに失敗しました。<br />${escape((e as Error).message)}`, true);
  }
}

async function openFile(file: File) {
  await open(file.name, await file.arrayBuffer(), true);
}

// --- ファイル選択・ドラッグ&ドロップ ---
const pick = () => fileInput.click();
pickButton.addEventListener("click", pick);
emptyButton.addEventListener("click", pick);
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void openFile(file);
  fileInput.value = "";
});

// dragenter/dragleave は子要素の出入りでも発生するので、数えて外に出たかを判定する
let dragDepth = 0;
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove("dragging");
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});

// --- 再生 ---
animList.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".anim");
  if (b?.dataset.name) play(b.dataset.name);
});
filter.addEventListener("input", renderList);
// Enter で、絞り込んだ先頭を再生する
filter.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  const first = animList.querySelector<HTMLButtonElement>(".anim");
  if (first?.dataset.name) play(first.dataset.name);
});

playButton.addEventListener("click", () => {
  if (!player) return;
  if (player.isPlaying) return void player.release();
  if (selected) play(selected);
});

// キャラクターをクリック: 待機以外のアニメーションをランダムに再生
canvas.addEventListener("click", () => {
  const pool = names.filter((n) => !isIdleName(n) && n !== player?.currentAnimation);
  const name = pool[Math.floor(Math.random() * pool.length)];
  if (name) play(name);
});

soundButton.addEventListener("click", () => {
  const on = soundButton.getAttribute("aria-pressed") !== "true";
  soundButton.setAttribute("aria-pressed", String(on));
  soundButton.title = on ? "効果音: オン" : "効果音: オフ";
  if (player) {
    player.soundEnabled = on;
    if (on) player.unlockAudio();
  }
});

window.addEventListener("resize", fitCanvas);

// 作業ウィンドウ (同じオリジン) で選んだキャラクターがあれば、そのまま使う
void loadCharacter()
  .then((saved) => {
    if (saved && !character) return open(saved.name, saved.data, false);
  })
  .catch(() => undefined);
