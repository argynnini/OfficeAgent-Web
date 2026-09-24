import { AcsPlayer } from "./acs/player";
import { imageToDataUrl } from "./acs/icon";
import { AcsCharacter } from "./acs/reader";
import { IdleController, isIdleAnimation } from "./idle";
import { loadCharacter, saveCharacter } from "./store";

const fileInput = document.getElementById("file") as HTMLInputElement;
const pickButton = document.getElementById("pick") as HTMLButtonElement;
const emptyButton = document.getElementById("empty") as HTMLButtonElement;
const playButton = document.getElementById("play") as HTMLButtonElement;
const soundButton = document.getElementById("sound") as HTMLButtonElement;
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const balloon = document.getElementById("balloon") as HTMLElement;
const balloonText = document.getElementById("balloon-text") as HTMLElement;
const balloonClose = document.getElementById("balloon-close") as HTMLButtonElement;
const sizeRow = document.getElementById("size-row") as HTMLElement;
const sizeInput = document.getElementById("size") as HTMLInputElement;
const sizeValue = document.getElementById("size-value") as HTMLOutputElement;
const nameLabel = document.getElementById("name") as HTMLElement;
const pickIcon = document.getElementById("pick-icon") as HTMLImageElement;
const pickEmoji = document.getElementById("pick-emoji") as HTMLElement;
const animsPanel = document.getElementById("anims") as HTMLElement;
const filter = document.getElementById("filter") as HTMLInputElement;
const animList = document.getElementById("anim-list") as HTMLElement;

/** キャラクターの表示倍率 (%) を覚えておく。ステージより大きくなる分は CSS (max-width: 100%) で縮める */
const SIZE_KEY = "officeagent.demoSize";

let player: AcsPlayer | undefined;
let character: AcsCharacter | undefined;
let names: string[] = [];
/** 最後に選んだアニメーション (再生ボタンで繰り返す) */
let selected: string | undefined;

/** 吹き出しにメッセージを出す (× で閉じていても、新しいメッセージでまた出す) */
function say(html: string, error = false) {
  balloonText.innerHTML = html;
  balloon.dataset.error = String(error);
  balloon.hidden = false;
}

/** 既定の favicon (キャラクターにアイコンが無ければこれに戻す) */
const faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
const DEFAULT_FAVICON = faviconLink?.href ?? "";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** スライダーの倍率で表示する (ドット絵なので image-rendering: pixelated で拡大) */
function applySize() {
  const percent = Number(sizeInput.value);
  sizeValue.value = `${percent}%`;
  if (character) canvas.style.width = `${Math.round((character.width * percent) / 100)}px`;
}

try {
  const saved = localStorage.getItem(SIZE_KEY);
  if (saved) sizeInput.value = saved;
} catch { /* 保存できない環境では既定のまま */ }

/** 待機動作 (Idle) の再生中は、再生ボタンを「停止」にせず、一覧でも強調しない (作業ウィンドウと同じ) */
const userAnimationPlaying = () => !!player?.isPlaying && !isIdleAnimation(character, player.currentAnimation);

// 放置すると、ときどき待機動作を再生する (放置が長いほど深い動き。作業ウィンドウと同じ)
const idle = new IdleController({
  player: () => player,
  character: () => character,
  busy: () => false,
});
idle.start();

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
      b.setAttribute("aria-current", String(userAnimationPlaying() && n === player?.currentAnimation));
      return b;
    }),
  );
}

function markCurrent() {
  const current = userAnimationPlaying() ? player?.currentAnimation : undefined;
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
      const user = playing && userAnimationPlaying();
      playButton.dataset.playing = String(user);
      playButton.title = playButton.ariaLabel = user ? "停止" : "再生";
      markCurrent();
      if (!playing) idle.animationEnded();
    };
    // 読み込んだ時点から放置時間を数え直す (直後から深い待機動作が出ないように)
    idle.userActivity();

    names = [...next.animations.keys()].sort((a, b) => a.localeCompare(b));
    filter.value = "";
    renderList();

    canvas.hidden = false;
    emptyButton.hidden = true;
    animsPanel.hidden = false;
    sizeRow.hidden = false;
    playButton.disabled = false;
    applySize();

    const title = next.name ?? fileName.replace(/\.acs$/i, "");
    // キャラクターのタスクトレイ用アイコンがあれば、選ぶボタンの 🐬 の代わりと、ブラウザのタブに出す (作業ウィンドウと同じ)
    const icon = next.trayIcon && imageToDataUrl(next.trayIcon);
    if (icon) pickIcon.src = icon;
    pickIcon.hidden = !icon;
    pickEmoji.hidden = !!icon;
    nameLabel.innerHTML = `<strong>${escape(title)}</strong> · ${next.width}×${next.height} · ${names.length} アニメーション`;
    if (faviconLink) faviconLink.href = icon || DEFAULT_FAVICON;
    nameLabel.title = fileName;
    say(
      next.description
        ? escape(next.description)
        : `<b>${escape(title)}</b> です。下の一覧からアニメーションを選んでください。`,
    );

    if (save) await saveCharacter(fileName, data).catch(() => undefined);

    // 登場アニメ (Greeting → Showing 状態の割り当て → Show) があれば再生し、なければ待機姿勢を描く
    const entrance = ["Greeting", ...next.stateAnimations("Showing"), "Show"].find((n) => next.animations.has(n));
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
  if (userAnimationPlaying()) return void player.release();
  if (selected) play(selected);
});

// キャラクターをクリック: 待機以外のアニメーションをランダムに再生
canvas.addEventListener("click", () => {
  const pool = names.filter((n) => !isIdleAnimation(character, n) && n !== player?.currentAnimation);
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

sizeInput.addEventListener("input", () => {
  applySize();
  try {
    localStorage.setItem(SIZE_KEY, sizeInput.value);
  } catch { /* ignore */ }
});

balloonClose.addEventListener("click", () => {
  balloon.hidden = true;
});

// 操作があったら放置時間を数え直し、待機動作中なら自然に終わらせる
for (const type of ["pointerdown", "keydown"]) {
  document.addEventListener(type, () => {
    idle.userActivity();
    void idle.interrupt();
  });
}

// 作業ウィンドウ (同じオリジン) で選んだキャラクターがあれば、そのまま使う
void loadCharacter()
  .then((saved) => {
    if (saved && !character) return open(saved.name, saved.data, false);
  })
  .catch(() => undefined);
