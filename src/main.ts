import msagent, { imageToDataUrl, isActFile, type Agent, type AgentRequest } from "@argynnini/msagent.js";
import { deleteCharacter, loadCharacter, saveCharacter } from "./store";

const fileInput = document.getElementById("file") as HTMLInputElement;
const pickButton = document.getElementById("pick") as HTMLButtonElement;
const emptyButton = document.getElementById("empty") as HTMLButtonElement;
const playButton = document.getElementById("play") as HTMLButtonElement;
const soundButton = document.getElementById("sound") as HTMLButtonElement;
const home = document.getElementById("home") as HTMLElement;
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
const speakForm = document.getElementById("speak") as HTMLFormElement;
const speakInput = document.getElementById("speak-text") as HTMLInputElement;
const speakButton = document.getElementById("speak-button") as HTMLButtonElement;

/** キャラクターの表示倍率 (%) を覚えておく */
const SIZE_KEY = "officeagent.demoSize";

let agent: Agent | undefined;
/** 外している途中 (退場アニメーションの再生中) のキャラクター。その間に別のキャラクターを選んだら、すぐ片付ける */
let leaving: Agent | undefined;
let names: string[] = [];
/** 最後に選んだアニメーション (再生ボタンで繰り返す) */
let selected: string | undefined;
/** 「話す」でしゃべらせている命令 (読み込み直後の案内など、ほかのしゃべりは含めない) */
let userSpeech: AgentRequest | undefined;
/** 描いているアニメーション。待機動作 (Idle) かどうかも覚える */
let current: { name: string; idle: boolean } | undefined;

/** ステージの吹き出しにメッセージを出す (× で閉じていても、新しいメッセージでまた出す) */
function say(html: string, error = false) {
  balloonText.innerHTML = html;
  balloon.dataset.error = String(error);
  balloon.hidden = false;
}

/** 既定の favicon (キャラクターにアイコンが無ければこれに戻す) */
const faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
const DEFAULT_FAVICON = faviconLink?.href ?? "";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** スライダーの倍率で表示する (拡大はドット絵のまま。足もとの位置は変わらない) */
function applySize() {
  const percent = Number(sizeInput.value);
  sizeValue.value = `${percent}%`;
  if (agent) agent.scale = percent / 100;
}

try {
  const saved = localStorage.getItem(SIZE_KEY);
  if (saved) sizeInput.value = saved;
} catch { /* 保存できない環境では既定のまま */ }

/** 待機動作 (Idle) の再生中は、再生ボタンを「停止」にせず、一覧でも強調しない (作業ウィンドウと同じ) */
const userAnimationPlaying = () => !!current && !current.idle;

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
      b.setAttribute("aria-current", String(userAnimationPlaying() && n === current?.name));
      return b;
    }),
  );
}

/** 再生ボタンと一覧の強調を、いま描いているアニメーションに合わせる */
function markCurrent() {
  const user = userAnimationPlaying();
  playButton.dataset.playing = String(user);
  playButton.title = playButton.ariaLabel = user ? "停止" : "再生";
  animList.querySelectorAll<HTMLButtonElement>(".anim").forEach((b) => {
    b.setAttribute("aria-current", String(user && b.dataset.name === current?.name));
  });
}

/** アニメーションを再生する。順番待ちや再生中の動きは捨てて、すぐ切り替える */
function play(name: string) {
  if (!agent) return;
  selected = name;
  agent.stop();
  agent.play(name);
}

/** 読み込んだ画面の表示 (キャラクター名・一覧など) を、キャラクター未選択の状態に戻す */
function resetView() {
  names = [];
  selected = undefined;
  current = undefined;
  userSpeech = undefined;
  animList.replaceChildren();
  animsPanel.hidden = speakForm.hidden = sizeRow.hidden = true;
  playButton.disabled = true;
  markCurrent();
  speakButton.textContent = "🗣 話す";
  nameLabel.textContent = "キャラクター未選択";
  nameLabel.title = "";
  pickIcon.hidden = true;
  pickEmoji.hidden = false;
  if (faviconLink) faviconLink.href = DEFAULT_FAVICON;
}

/** 最初に吹き出しに出している案内 (キャラクターを外したら、これに戻す) */
const INITIAL_BALLOON = balloonText.innerHTML;

/**
 * キャラクターを外す (キャラクター選択ボタンの右クリック)。退場アニメーション (Hiding の割り当て → Hide) を再生してから消し、
 * 保存も消して、次回は自動で読み込まない
 */
function unload() {
  if (!agent) return;
  const old = (leaving = agent);
  agent = undefined;
  resetView();
  say(INITIAL_BALLOON);
  void deleteCharacter().catch(() => undefined);
  old.stop();
  void old.hide().then(() => {
    old.destroy();
    if (leaving !== old) return; // 退場中に別のキャラクターを選んだ
    leaving = undefined;
    home.hidden = true;
    emptyButton.hidden = false;
  });
}

/** ステージの真ん中 (目印の要素の下端の中央) に、キャラクターの足もとを置く */
function placeAtHome(next: Agent) {
  const r = home.getBoundingClientRect();
  next.left = r.left + (r.width - next.width) / 2;
  next.top = r.bottom - next.height;
}

async function open(fileName: string, data: ArrayBuffer, save: boolean) {
  say(`<b>${escape(fileName)}</b> を読み込み中…`);
  let next: Agent;
  try {
    next = await msagent.load({
      name: data,
      scale: Number(sizeInput.value) / 100,
      sound: soundButton.getAttribute("aria-pressed") === "true",
    });
  } catch (e) {
    say(`読み込みに失敗しました。<br />${escape((e as Error).message)}`, true);
    return;
  }
  // 前のキャラクター (退場中のものも) は、すぐ片付ける
  agent?.destroy();
  leaving?.destroy();
  leaving = undefined;
  agent = next;
  current = undefined;
  userSpeech = undefined;
  speakButton.textContent = "🗣 話す";

  next.on("animationstart", (e) => {
    current = e.detail;
    markCurrent();
  });
  next.on("animationend", (e) => {
    if (current?.name === e.detail.name) current = undefined;
    markCurrent();
  });
  // キャラクターをクリック: 待機以外のアニメーションをランダムに再生 (透明な部分のクリックは、下のページに届く)
  next.on("click", (e) => {
    if (e.detail.button !== "left") return;
    next.stop();
    next.animate();
  });
  // 右クリックのメニュー (「隠す」など) で隠れたら、キャラクターを外す
  next.on("hide", (e) => {
    if (e.detail.cause === "user" && agent === next) unload();
  });

  names = next.animations().sort((a, b) => a.localeCompare(b));
  filter.value = "";
  renderList();

  emptyButton.hidden = true;
  home.hidden = false;
  animsPanel.hidden = false;
  speakForm.hidden = false;
  sizeRow.hidden = false;
  playButton.disabled = false;
  const { character } = next;
  placeAtHome(next);

  const title = next.name ?? fileName.replace(/\.ac[st]$/i, "");
  // キャラクターのタスクトレイ用アイコンがあれば、選ぶボタンの 🐬 の代わりと、ブラウザのタブに出す (作業ウィンドウと同じ)
  const icon = character.trayIcon && imageToDataUrl(character.trayIcon);
  if (icon) pickIcon.src = icon;
  pickIcon.hidden = !icon;
  pickEmoji.hidden = !!icon;
  // 形式 (ACS = Microsoft Agent / ACT = Office 97 のアシスタント) も並べて出す
  const format = isActFile(data)
    ? `<span class="format" title="Office 97 のアシスタント (.act)">ACT</span>`
    : `<span class="format" title="Microsoft Agent のキャラクター (.acs)">ACS</span>`;
  nameLabel.innerHTML = `<strong>${escape(title)}</strong> ${format} · ${character.width}×${character.height} · ${names.length} アニメーション`;
  if (faviconLink) faviconLink.href = icon || DEFAULT_FAVICON;
  nameLabel.title = fileName;
  // ステージの吹き出しは閉じ、ここからはキャラクター自身の吹き出しでしゃべる
  balloon.hidden = true;

  if (save) await saveCharacter(fileName, data).catch(() => undefined);

  // 登場アニメ (Showing 状態の割り当て → Show) の後、あいさつ (Greeting) があれば続ける
  next.show();
  if (next.hasAnimation("Greeting")) {
    selected = "Greeting";
    next.play("Greeting");
  }
  next.speak("ドラッグで好きな場所へ動かせます。右クリックでメニュー、クリックでランダムに動きます。", { voice: false });
}

async function openFile(file: File) {
  await open(file.name, await file.arrayBuffer(), true);
}

// --- ファイル選択・ドラッグ&ドロップ ---
const pick = () => fileInput.click();
pickButton.addEventListener("click", pick);
// 右クリックで、キャラクターを外す (ブラウザのメニューは出さない)
pickButton.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  unload();
});
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
  if (!agent) return;
  if (userAnimationPlaying() || agent.speaking) return agent.stop();
  if (selected) play(selected);
});

soundButton.addEventListener("click", () => {
  const on = soundButton.getAttribute("aria-pressed") !== "true";
  soundButton.setAttribute("aria-pressed", String(on));
  soundButton.title = on ? "効果音: オン" : "効果音: オフ";
  if (agent) agent.sound = on;
});

// --- しゃべらせる ---
/** 空欄のまま「話す」を押したときの自己紹介: 紹介文 (無ければ名前だけ) */
function selfIntroduction(): string {
  if (!agent) return "";
  const description = agent.description?.trim();
  if (description) return description;
  const name = agent.name ?? nameLabel.title.replace(/\.ac[st]$/i, "");
  return `こんにちは、${name}です。`;
}

speakForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!agent) return;
  if (userSpeech) return agent.stop(userSpeech);
  const text = speakInput.value.trim() || selfIntroduction();
  if (!text) return;
  // 声の速さ・高さは、キャラクターの設定 (ACS の音声の設定) に合わせる (例: Merlin は低くゆっくり)。
  // 待機動作は自然に終わらせ、話すときの動き (Speaking 状態の割り当て) にする
  agent.stop();
  const request = (userSpeech = agent.speak(text));
  speakButton.textContent = "■ やめる";
  void request.then(() => {
    if (userSpeech !== request) return;
    userSpeech = undefined;
    speakButton.textContent = "🗣 話す";
  });
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

// 作業ウィンドウ (同じオリジン) で選んだキャラクターがあれば、そのまま使う
void loadCharacter()
  .then((saved) => {
    if (saved && !agent) return open(saved.name, saved.data, false);
  })
  .catch(() => undefined);
