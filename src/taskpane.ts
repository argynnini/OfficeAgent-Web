import { AcsPlayer } from "./acs/player";
import { imageToDataUrl } from "./acs/icon";
import { AcsCharacter } from "./acs/reader";
import { ActCharacter, isActFile } from "./act/reader";
import type { Character } from "./character";
import DOMPurify from "dompurify";
import { watchWorksheetActivated } from "./excel";
import { askGroq, GroqChatMessage, testGroqKey } from "./groq";
import { IdleController, isIdleAnimation } from "./idle";
import { marked } from "marked";
import { buildEmbedUrl, buildSearchUrl, SEARCH_ENGINES } from "./search";
import { deleteCharacter, loadCharacter, saveCharacter } from "./store";
import { AI_TASKS, AiTask, DEFAULT_AI_TASK, findAiTask } from "./tasks";
import { watchWordEvents } from "./word";

marked.setOptions({ breaks: true, gfm: true });
// リンクは、他のタブで安全に開く (target/rel はサニタイズ後に付け直さないと DOMPurify に消される)
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage");
const status = $("status");
const statusTitle = $("status-title");
const statusDesc = $("status-desc");
const flyout = $("flyout");

/** 検索吹き出しの代わりに出す見出し + 補足。title が空なら隠す (title だけの1行でもよい) */
function setStatus(title: string, desc = "") {
  statusTitle.textContent = title;
  statusDesc.textContent = desc;
  status.hidden = !title;
}
const playButton = $<HTMLButtonElement>("play");
const pickButton = $<HTMLButtonElement>("pick");
const pickIcon = $<HTMLImageElement>("pick-icon");
const pickEmoji = pickButton.querySelector<HTMLElement>(".emoji")!;
const queryInput = $<HTMLTextAreaElement>("query");
const engineSelect = $<HTMLSelectElement>("engine");
const fileInput = $<HTMLInputElement>("file");
const soundButton = $<HTMLButtonElement>("sound");
const SOUND_KEY = "officeagent.sound";
let soundOn = true;
try {
  soundOn = localStorage.getItem(SOUND_KEY) !== "off";
} catch { /* 保存できない環境では既定 (オン) */ }

function renderSoundButton() {
  soundButton.setAttribute("aria-pressed", String(soundOn));
  soundButton.title = soundOn ? "効果音: オン\nクリックでオフにします。" : "効果音: オフ\nクリックでオンにします。";
}
renderSoundButton();

let player: AcsPlayer | undefined;
let character: Character | undefined;
/** 性格リセット用に覚えておく、現在のキャラクターの表示名 */
let currentCharacterDisplayName: string | undefined;

/** キャラクター未選択の間は、選ぶボタンを点滅させて誘導し、キャラクターが要る音声・再生ボタンは無効にする */
function updateCharacterRequiredUi() {
  const loaded = !!character;
  pickButton.classList.toggle("attract", !loaded);
  soundButton.disabled = !loaded;
  playButton.disabled = !loaded;
}
updateCharacterRequiredUi();

/** 自動再生に向かない (待機・登場・退場) アニメーションを除く */
const SKIP = /^(Idle|RestPose|Show|Hide|GoodBye|Greet)/i;

let lastAnimation: string | undefined;

/** 自分で再生したアニメーションの再生中か (放置中に勝手に始まる待機動作は含めない) */
const userAnimationPlaying = () => !!player?.isPlaying && !isIdleAnimation(character, player.currentAnimation);

/** 再生中は ■ (クリックで停止)、待機中は ▶。待機動作 (Idle) の再生中は ▶ のまま */
function renderPlayButton(playing: boolean) {
  playing = playing && userAnimationPlaying();
  playButton.dataset.playing = String(playing);
  playButton.title = playing
    ? "停止\nクリックでアニメーションを止めて待機ポーズに戻します。"
    : "アニメーションを再生\nマウスを載せると一覧から選べます。";
}

function playAnimation(name: string) {
  lastAnimation = name;
  void player?.play(name);
}

function playRandom() {
  if (!player || !character) return;
  const names = [...character.animations.keys()].filter((n) => !SKIP.test(n));
  const name = names[Math.floor(Math.random() * names.length)];
  if (name) void player.play(name);
}

/** 外している途中 (退場アニメーションの再生中) のプレイヤー。その間に別のキャラクターを選んだら止める */
let leavingPlayer: AcsPlayer | undefined;

/**
 * キャラクターを外す (キャラクター選択ボタンの右クリック)。退場アニメーション (Hiding の割り当て → Hide) を再生してから消し、
 * 保存も消して、次回は自動で読み込まない。画面はキャラクター未選択の状態に戻す
 */
function unloadCharacter() {
  if (!character || !player) return;
  const leaving = player;
  const hide = firstAnimation(...character.stateAnimations("Hiding"), "Hide");
  cancelThinking();
  character = undefined;
  player = undefined;
  currentCharacterDisplayName = undefined;
  lastAnimation = undefined;
  flyout.replaceChildren();
  canvas.title = "";
  canvas.style.cursor = "default";
  pickIcon.hidden = true;
  pickEmoji.hidden = false;
  renderPlayButton(false);
  updateCharacterRequiredUi();
  setStatus("キャラクターファイルを選択してください。", "🐬をクリックして、Microsoft Agent のキャラクター (.acs) か、Office 97 のアシスタント (.act) を選択してください");
  void deleteCharacter().catch(() => undefined);

  leavingPlayer = leaving;
  const clear = () => {
    if (leavingPlayer !== leaving) return; // 退場中に別のキャラクターを選んだ
    leavingPlayer = undefined;
    leaving.stop();
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  };
  if (hide) void leaving.play(hide).then(clear);
  else clear();
}

function useCharacter(data: ArrayBuffer, name: string) {
  leavingPlayer?.stop();
  leavingPlayer = undefined;
  player?.stop();
  // Microsoft Agent のキャラクター (.acs) か、Office 97 のアシスタント (.act) か
  character = isActFile(data) ? new ActCharacter(data) : new AcsCharacter(data);
  player = new AcsPlayer(character, canvas);
  player.soundEnabled = soundOn;
  // 既にクリックなどの操作が済んでいれば (例: キャラを選ぶ前に何か触っていた場合)、ここで先に再開しておく
  player.unlockAudio();
  player.onPlayingChange = (playing) => {
    renderPlayButton(playing);
    if (!playing) idle.animationEnded();
  };
  renderPlayButton(false);
  // 読み込んだ時点から放置時間を数え直す (直後から深い待機動作が出ないように)
  idle.userActivity();
  // 登場: 最初は何も描かず (見えない状態)、Greeting (無ければ Showing 状態の割り当て → Show) で現れる。
  // どちらも無いキャラクターは、待機ポーズをそのまま表示する
  const appear = firstAnimation("Greeting", ...character.stateAnimations("Showing"), "Show");
  if (appear) {
    void player.play(appear);
  } else {
    const rest = character.animations.get("RestPose") ?? character.animations.values().next().value;
    if (rest?.frames[0]) player.draw(rest.frames[0]);
  }
  // キャラクター名 (ACS に埋め込まれた名前。読めなければファイル名から拡張子を除いたもの) はツールチップに出す
  const displayName = character.name || name.replace(/\.[^.]+$/, "");
  canvas.title = `${displayName}\nクリックでアニメーション`;
  currentCharacterDisplayName = displayName;
  // キャラクターを選ぶボタンは、タスクトレイ用アイコンがあれば 🐬 の代わりにそれを出す (無ければ 🐬 のまま)
  const icon = character.trayIcon && imageToDataUrl(character.trayIcon);
  if (icon) pickIcon.src = icon;
  pickIcon.hidden = !icon;
  pickEmoji.hidden = !!icon;
  applyCharacterPersonaIfUnset(displayName, character.description);
  setStatus("");
  updateCharacterRequiredUi();

  const names = [...character.animations.keys()].sort();
  flyout.replaceChildren(
    ...names.map((n) => {
      const item = document.createElement("button");
      item.type = "button";
      item.role = "menuitem";
      item.textContent = n;
      item.addEventListener("click", () => {
        playAnimation(n);
        // フォーカスを外してマウスが離れたらメニューが閉じるようにする
        (document.activeElement as HTMLElement | null)?.blur();
      });
      return item;
    }),
  );
}

async function pickFile(file: File) {
  try {
    const data = await file.arrayBuffer();
    useCharacter(data, file.name);
    await saveCharacter(file.name, data).catch(() => undefined);
  } catch (e) {
    setStatus(`読み込みに失敗しました: ${(e as Error).message}`);
    updateCharacterRequiredUi();
  }
}

// --- 本文の選択範囲を、吹き出しのプレースホルダーに薄く表示し、Tab で挿入できるようにする ---
/** 検索エンジンを選んでいるときの既定のプレースホルダー (Groq を選んでいるときは defaultPlaceholder() が質問向けの文言に変える) */
const SEARCH_PLACEHOLDER = queryInput.placeholder;
const GROQ_PLACEHOLDER = SEARCH_PLACEHOLDER.replace("［検索］", "［質問］");
const PLACEHOLDER_MAX_CHARS = 120;
/** 候補の先頭に付ける操作の案内 (長い候補で切れないよう先頭に置く) */
const SUGGESTION_HINT = "[Tab]で挿入: ";
/** 本文で選択中のテキスト (なければ空) */
let suggestion = "";

/** Groq に頼む作業 (質問・要約・翻訳…)。質問ボタンの ▾ で選び、次回も同じものを使う */
const AI_TASK_KEY = "officeagent.aiTask";
let currentTask: AiTask = DEFAULT_AI_TASK;
try {
  currentTask = findAiTask(localStorage.getItem(AI_TASK_KEY));
} catch { /* 保存できない環境では既定 (質問) のまま */ }

const isGroqSelected = () => engineSelect.value === GROQ_ENGINE_NAME;
/** 質問以外 (要約・翻訳など) は、入力欄が空なら本文の選択範囲を対象にする */
const usesSelection = () => isGroqSelected() && currentTask !== DEFAULT_AI_TASK;

function defaultPlaceholder(): string {
  if (usesSelection()) {
    return `本文を選択するか、ここに文章を入力して、［${currentTask.label}］をクリックしてください！`;
  }
  return isGroqSelected() ? GROQ_PLACEHOLDER : SEARCH_PLACEHOLDER;
}

function setSuggestion(text: string) {
  suggestion = text.trim();
  const flat = suggestion.replace(/\s+/g, " ");
  const shown = flat.length > PLACEHOLDER_MAX_CHARS ? flat.slice(0, PLACEHOLDER_MAX_CHARS) + "…" : flat;
  // 要約などは、入力しなくても選択範囲がそのまま対象になるので、Tab の案内ではなくそのことを出す
  const hint = usesSelection() ? `［${currentTask.label}］で選択範囲を${currentTask.label}: ` : SUGGESTION_HINT;
  queryInput.placeholder = flat ? hint + shown : defaultPlaceholder();
  queryInput.classList.toggle("suggest", flat !== "");
}

function showSelection() {
  if (typeof Office === "undefined" || !Office.context?.document) return;
  Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => {
    if (r.status !== Office.AsyncResultStatus.Succeeded) {
      setSuggestion("");
      return;
    }
    const text = String(r.value ?? "");
    setSuggestion(text);
  });
}

function onSelectionChanged() {
  idle.userActivity();
  showSelection();
}

// --- ウェブ検索 (結果は作業ウィンドウ内に表示する) / Groq (AI に質問、結果はチャット形式) ---
const ENGINE_KEY = "officeagent.engine";
/** 検索エンジンではなく Groq (AI) を選んでいるときの、engineSelect の値 */
const GROQ_ENGINE_NAME = "Groq";
/** 選んでいるモデル名を、表示だけ「Groq (モデル名)」のように付け足す (value は GROQ_ENGINE_NAME のまま) */
const groqEngineOption = new Option(GROQ_ENGINE_NAME, GROQ_ENGINE_NAME);
engineSelect.replaceChildren(...SEARCH_ENGINES.map((e) => new Option(e.name, e.name)), groqEngineOption);
try {
  // 保存しているのは検索エンジン名。以前の版の番号や、いまは無いエンジン名なら、先頭を選ぶ
  engineSelect.value = localStorage.getItem(ENGINE_KEY) ?? "";
} catch { /* 保存できない環境では既定のまま */ }
if (engineSelect.selectedIndex < 0) engineSelect.selectedIndex = 0;

const searchButton = $<HTMLButtonElement>("search");
const taskToggle = $<HTMLButtonElement>("task-toggle");
const taskMenu = $("task-menu");
/** Groq を選んでいる間は、ボタンの見た目を「検索」から、選んでいる作業 (質問・要約…) にし、▾ を出す */
function updateSearchButtonLabel() {
  const groq = isGroqSelected();
  searchButton.innerHTML = `${groq ? currentTask.label : "検索"}(<u>S</u>)`;
  taskToggle.hidden = !groq;
  if (!groq) closeTaskMenu();
}
updateSearchButtonLabel();
setSuggestion(suggestion);

engineSelect.addEventListener("change", () => {
  try {
    localStorage.setItem(ENGINE_KEY, engineSelect.value);
  } catch { /* ignore */ }
  updateSearchButtonLabel();
  setSuggestion(suggestion);
});

// --- AI に頼む作業のメニュー (質問ボタンの ▾)。選ぶと作業を切り替えるだけで、送信はしない ---
function renderTaskMenu() {
  taskMenu.replaceChildren(
    ...AI_TASKS.map((task) => {
      const b = document.createElement("button");
      b.type = "button";
      b.role = "menuitemradio";
      b.dataset.task = task.id;
      b.setAttribute("aria-checked", String(task === currentTask));
      const label = document.createElement("span");
      label.textContent = task.label;
      const desc = document.createElement("span");
      desc.className = "desc";
      desc.textContent = task.description;
      b.append(label, desc);
      return b;
    }),
  );
}

function openTaskMenu() {
  renderTaskMenu();
  taskMenu.hidden = false;
  taskToggle.setAttribute("aria-expanded", "true");
  taskMenu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
}

function closeTaskMenu() {
  taskMenu.hidden = true;
  taskToggle.setAttribute("aria-expanded", "false");
}

function selectTask(task: AiTask) {
  currentTask = task;
  try {
    localStorage.setItem(AI_TASK_KEY, task.id);
  } catch { /* ignore */ }
  closeTaskMenu();
  updateSearchButtonLabel();
  setSuggestion(suggestion);
  // 選んだだけでは送らない (送信はボタン / Enter / Alt+S のときだけ)。ボタンにフォーカスを戻して、続けて押せるようにする
  searchButton.focus();
}

taskToggle.addEventListener("click", () => (taskMenu.hidden ? openTaskMenu() : closeTaskMenu()));
taskMenu.addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.task;
  if (id) selectTask(findAiTask(id));
});
// ↑↓ で項目を移動、Esc で閉じて ▾ に戻る
taskMenu.addEventListener("keydown", (e) => {
  const items = Array.from(taskMenu.querySelectorAll<HTMLButtonElement>("button"));
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  } else if (e.key === "Escape") {
    closeTaskMenu();
    taskToggle.focus();
  }
});
document.addEventListener("pointerdown", (e) => {
  const t = e.target as Node;
  if (!taskMenu.hidden && !taskMenu.contains(t) && !taskToggle.contains(t)) closeTaskMenu();
});

function drawRest() {
  const rest = character?.animations.get("RestPose")?.frames[0];
  if (rest) player?.draw(rest);
}

const firstAnimation = (...names: string[]) => names.find((n) => character?.animations.has(n));

// --- 検索ボックスにフォーカス中は Writing を続け、外れたらやめる動きを再生して待機ポーズに戻す ---
let focused = false;
/** 検索実行の Thinking 再生中は Writing を止めておく */
let thinking = false;

function playWriting() {
  const name = firstAnimation("Writing", "Write");
  if (!focused || thinking || !name || !player) return;
  void player.play(name).then(playWriting);
}

queryInput.addEventListener("focus", () => {
  focused = true;
  // 待機動作中なら、終了分岐で自然に終わらせてから Writing へ
  void idle.interrupt().then(playWriting);
});
queryInput.addEventListener("blur", () => {
  focused = false;
  // 途中で切らず、Writing の終了分岐 (書くのをやめる動き) を最後まで再生してから待機ポーズへ
  void player?.release().then(() => {
    // 別のアニメーション (メニュー選択など) が始まっていれば待機ポーズで上書きしない
    if (!focused && !thinking && !player?.isPlaying) drawRest();
  });
});

// --- 待機動作: 放置するとときどき Idle 系を再生する (放置が長いほど深い動き) ---
const idle = new IdleController({
  player: () => player,
  character: () => character,
  busy: () => focused || thinking,
});
idle.start();
for (const type of ["pointerdown", "keydown"]) {
  document.addEventListener(type, () => {
    idle.userActivity();
    player?.unlockAudio();
  });
}

// --- ドキュメント側のイベントへの反応 (Word のコメント追加・削除、段落追加、Excel のシート切り替えなど) ---
/** 待機動作を自然に終わらせてから、候補の先頭に見つかったアニメーションを 1 つ再生する (入力中・検索中・他の再生中は何もしない) */
function reactTo(...candidates: string[]) {
  if (!player || !character || focused || thinking || userAnimationPlaying()) return;
  const name = firstAnimation(...candidates);
  if (!name) return;
  void idle.interrupt().then(() => {
    if (focused || thinking || userAnimationPlaying()) return;
    void player?.play(name);
  });
}

/** fn の呼び出し間隔を空ける (頻発するイベントに反応させても、うるさくならないように) */
function throttled(minMs: number, fn: () => void): () => void {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last < minMs) return;
    last = now;
    fn();
  };
}

const REACT_THROTTLE_MS = 15_000;
/** 段落追加 (Enter で新しい段落) は書いている間ずっと発火するので間引く */
const onParagraphAdded = throttled(REACT_THROTTLE_MS, () => reactTo("Acknowledge", "GestureDown", "LookDown", "GetAttention"));

/** シート切り替えも、連続で切り替えられても騒がしくならないよう間引く */
const onSheetActivated = throttled(REACT_THROTTLE_MS, () => reactTo("GestureRight", "LookRight", "Alert", "GetAttention"));

/** 読み込みが終わらないまま Thinking が続き続けないようにする上限 */
const THINKING_MAX_MS = 20_000;
let thinkingTimer: number | undefined;

/** 検索の読み込み中は Thinking を繰り返す。stopThinking() (読み込み完了) で終わる */
function playThinking() {
  const name = firstAnimation("Thinking", "Processing");
  if (!name || !player) return;
  thinking = true;
  window.clearTimeout(thinkingTimer);
  thinkingTimer = window.setTimeout(stopThinking, THINKING_MAX_MS);

  const loop = (first: boolean) => {
    if (!thinking || !player) return;
    // 2 回目以降: 別のアニメーション (メニュー選択など) に切り替えられていたら、Thinking は諦める
    if (!first && player.isPlaying) return cancelThinking();
    void player.play(name).then(() => loop(false));
  };
  loop(true);
}

function cancelThinking() {
  thinking = false;
  window.clearTimeout(thinkingTimer);
}

/** 検索結果の読み込み待ちか (読み込み完了で GetWizardy を再生するための印) */
let searchPending = false;

/** 検索の後始末: 入力中なら Writing、そうでなければ待機ポーズへ */
function afterSearch() {
  if (focused) playWriting();
  else if (!player?.isPlaying) drawRest();
}

/**
 * Thinking を終了分岐で自然に終わらせる。
 * completed (検索結果の読み込み完了) のときは、そのあと GetWizardy があれば再生する (なければ何もしない)。
 * 読み込みが終わらずタイムアウトしたときは completed=false で、Thinking を止めるだけ。
 */
function stopThinking(completed = false) {
  const wasThinking = thinking;
  cancelThinking();
  if (!wasThinking && !completed) return;
  // Thinking を自分で別のアニメーションに切り替えていたら、その再生を邪魔しない
  if (!wasThinking && userAnimationPlaying()) return;

  void ((wasThinking && player?.release()) || Promise.resolve()).then(() => {
    const name = completed ? firstAnimation("GetWizardy") : undefined;
    if (name && player) void player.play(name).then(afterSearch);
    else afterSearch();
  });
}

/** 検索結果の読み込み完了 */
function onSearchLoaded() {
  if (!searchPending) return;
  searchPending = false;
  stopThinking(true);
}

// --- 検索結果をペイン内 (iframe) に表示する。埋め込みを拒否するエンジンは別タブで開く ---
const results = $("results");
const resultsFrame = $<HTMLIFrameElement>("results-frame");
const resultsTitle = $("results-title");
const resultsOpenButton = $<HTMLButtonElement>("results-open");
/** 「ブラウザで開く」用: 表示中の検索を別タブで開く URL (Groq とのチャット中は無し) */
let resultsExternalUrl: string | undefined;

function showResults(engineName: string, embedUrl: string, externalUrl: string) {
  resultsExternalUrl = externalUrl;
  resultsTitle.textContent = `${engineName} の検索結果`;
  resultsOpenButton.hidden = false;
  chatMessages.hidden = true;
  resultsFrame.hidden = false;
  resultsFrame.src = embedUrl;
  results.hidden = false;
}

function closeResults() {
  // 読み込み中に閉じたら、完了扱いにはせず (GetWizardy は再生しない)、Thinking だけ止める
  searchPending = false;
  stopThinking();
  results.hidden = true;
  resultsFrame.src = "about:blank";
  resultsExternalUrl = undefined;
  // Groq とのチャットは、閉じたら次回は新しい会話として始める
  chatMessages.replaceChildren();
  chatHistory = [];
}

function openExternal(url: string) {
  // ユーザー操作の直後に開く (ポップアップブロック回避)
  const win = window.open(url, "_blank");
  if (win) win.opener = null;
  else setStatus("ブラウザに検索ページを開くのをブロックされました。許可してください。");
}

// 検索結果の読み込みが終わったら Thinking を終え、GetWizardy があれば再生する (検索中でなければ何もしない)
resultsFrame.addEventListener("load", onSearchLoaded);
$("results-close").addEventListener("click", closeResults);
resultsOpenButton.addEventListener("click", () => resultsExternalUrl && openExternal(resultsExternalUrl));

// --- Groq (AI) とのチャット。同じ結果パネルを使い回し、iframe の代わりにやり取りを積む ---
const chatMessages = $("chat-messages");
/** 実行中の Office ホスト (Word/Excel/PowerPoint)。Office.onReady で判明するまでは undefined */
let officeHostName: string | undefined;

function hostDisplayName(host: Office.HostType): string | undefined {
  switch (host) {
    case Office.HostType.Word: return "Word";
    case Office.HostType.Excel: return "Excel";
    case Office.HostType.PowerPoint: return "PowerPoint";
    default: return undefined;
  }
}

/** 既定では日本語で答えさせる (指定しないと、モデルによって英語やアラビア語など別の言語で返ってくることがある)。
 *  実行中のホスト名は、性格 (編集・保存される文面) とは別に、送信のたびに現在の値を付け足す */
function groqSystemPrompt(): GroqChatMessage {
  const persona = groqPersonaInput.value.trim() || DEFAULT_GROQ_PERSONA;
  const content = officeHostName ? `${persona} 現在は Microsoft ${officeHostName} 上で動いています。` : persona;
  return { role: "system", content };
}
/** 今回のパネルを開いてからのやり取り (システムプロンプトは含めない。Groq へ送るときに毎回付ける) */
let chatHistory: GroqChatMessage[] = [];

function addChatMessage(className: string, text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `chat-msg ${className}`;
  // AI の返答 (確定したものだけ) は Markdown として描画する。それ以外 (自分の発言・待機中・エラー) は素のテキスト
  if (className === "assistant") {
    const html = DOMPurify.sanitize(marked.parse(text, { async: false }));
    el.innerHTML = html;
    el.appendChild(buildCopyButton(text, html));
  } else {
    el.textContent = text;
  }
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

/** Word などにそのまま貼れるよう、書式付き (HTML) とプレーンテキストの両方をクリップボードに入れる */
async function copyRichText(plainText: string, html: string): Promise<boolean> {
  // 書式付き (HTML) を試し、環境の制限などで失敗したら、素のテキストだけでも貼れるようにする
  if (typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch (e) {
      console.warn("書式付きコピーに失敗したため、プレーンテキストで再試行します", e);
    }
  }
  try {
    await navigator.clipboard.writeText(plainText);
    return true;
  } catch (e) {
    console.warn("navigator.clipboard に失敗したため、execCommand で再試行します", e);
  }
  // タスクペインは Office 側の iframe に埋め込まれるため、Permissions-Policy で
  // navigator.clipboard 自体が使えないことがある。その場合の最後の手段
  return legacyCopyText(plainText);
}

function legacyCopyText(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {
    console.error("クリップボードへのコピーに失敗しました", e);
  }
  document.body.removeChild(ta);
  return ok;
}

const COPY_TITLE = "この返答をコピー (書式付きで貼り付けできます)";

function buildCopyButton(plainText: string, html: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chat-copy";
  btn.title = COPY_TITLE;
  btn.innerHTML = `
    <svg class="icon-copy" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
      <path d="M3.5 10.5v-6a1 1 0 0 1 1-1h6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    </svg>
    <svg class="icon-copied" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  btn.addEventListener("click", () => {
    void copyRichText(plainText, html).then(async (ok) => {
      btn.dataset.copied = String(ok);
      if (ok) {
        btn.title = "コピーしました";
        window.setTimeout(() => {
          delete btn.dataset.copied;
          btn.title = COPY_TITLE;
        }, 1500);
        return;
      }
      // 失敗時は、権限が拒否されているのかを調べて、直し方が分かるように案内する
      const guidance = (await clipboardPermissionState()) === "denied"
        ? "クリップボードへのアクセスが拒否されています。ブラウザのアドレスバー付近のアイコン（鍵マークなど）から、このサイトのクリップボードへのアクセスを許可してください。"
        : "コピーできませんでした。ブラウザや Office 側の制限で、クリップボードにアクセスできない可能性があります。";
      btn.title = guidance;
      setStatus(guidance);
      window.setTimeout(() => {
        delete btn.dataset.copied;
        btn.title = COPY_TITLE;
        setStatus("");
      }, 6000);
    });
  });
  return btn;
}

/** クリップボードへの書き込み権限の状態。対応していないブラウザでは undefined */
async function clipboardPermissionState(): Promise<PermissionState | undefined> {
  try {
    const status = await navigator.permissions.query({ name: "clipboard-write" as PermissionName });
    return status.state;
  } catch {
    return undefined;
  }
}

function showChat() {
  resultsTitle.textContent = "Groq";
  resultsExternalUrl = undefined;
  resultsOpenButton.hidden = true;
  resultsFrame.hidden = true;
  chatMessages.hidden = false;
  results.hidden = false;
}

/** チャットに表示する、自分の発言の最大文字数 (選択範囲が長くても、パネルが埋まらないように。送る内容は全文) */
const CHAT_ECHO_MAX_CHARS = 200;

/** text をそのまま、または作業 (要約など) の依頼文にして Groq に送る */
async function askGroqChat(text: string, task: AiTask = DEFAULT_AI_TASK) {
  showChat();
  const echo = text.length > CHAT_ECHO_MAX_CHARS ? text.slice(0, CHAT_ECHO_MAX_CHARS) + "…" : text;
  addChatMessage("user", task === DEFAULT_AI_TASK ? text : `【${task.label}】${echo}`);
  const pending = addChatMessage("assistant pending", "考え中…");
  playThinking();
  searchPending = false; // iframe の onload 経由ではなく、この後 fetch の完了で直接 stopThinking する

  const history = [...chatHistory, { role: "user" as const, content: task.build(text) }];
  const result = await askGroq(groqKeyInput.value.trim(), groqModelSelect.value, [groqSystemPrompt(), ...history]);
  pending.remove();
  if (result.ok) {
    chatHistory = [...history, { role: "assistant" as const, content: result.message }];
    addChatMessage("assistant", result.message);
  } else {
    addChatMessage("error", result.message);
  }
  stopThinking(true);
}

/** Groq に渡す対象: 入力欄の文字。要約などで入力欄が空なら、本文の選択範囲 */
function aiTarget(): string {
  return queryInput.value.trim() || (usesSelection() ? suggestion : "");
}

function runSearch() {
  if (isGroqSelected()) {
    const target = aiTarget();
    if (target) void askGroqChat(target, currentTask);
    return;
  }
  const text = queryInput.value.trim();
  if (!text) return;
  const engine = SEARCH_ENGINES.find((e) => e.name === engineSelect.value);
  if (!engine) return;
  playThinking();
  searchPending = true;

  showResults(engine.name, buildEmbedUrl(engine, text), buildSearchUrl(engine, text));
}

searchButton.addEventListener("click", runSearch);
// VSTO 版の「検索(&S)」と同じく Alt+S で検索 (ペインにフォーカスがあるときのみ)
document.addEventListener("keydown", (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    runSearch();
  }
});

// 入力欄での Tab は、taskpane.html の先頭の inline script が (Office.js より先に) 止めてフォーカスを動かさず、
// Shift なしのときだけ "query-tab" を送ってくる。入力欄が空で本文を選択中なら、選択範囲を挿入する (それ以外は何もしない)
queryInput.addEventListener("query-tab", () => {
  if (suggestion && queryInput.value === "") {
    queryInput.value = suggestion.slice(0, queryInput.maxLength);
    queryInput.setSelectionRange(queryInput.value.length, queryInput.value.length);
  }
});

// VSTO 版と同じく Enter で検索 (Shift+Enter で改行)。検索したら入力欄のフォーカスを外す
queryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    // 先にフォーカスを外す: Writing をやめる動き (blur) が終わってから Thinking を始める。
    // 逆にすると、blur の処理が始まったばかりの Thinking を終わらせてしまう
    queryInput.blur();
    runSearch();
  }
});

// カイル君をクリックするとランダムにアニメーション
// キャラクターの絵の上でだけ、クリックできる見た目 (指のカーソル) にして反応する。透明な部分のクリックは無視
canvas.addEventListener("pointermove", (e) => {
  canvas.style.cursor = player?.hitTest(e.clientX, e.clientY) ? "pointer" : "default";
});
canvas.addEventListener("click", (e) => {
  if (player?.hitTest(e.clientX, e.clientY)) playRandom();
});
// 再生ボタン: 再生中はクリックで停止して待機ポーズへ。待機中 (待機動作の再生中を含む) は直前のアニメーションをもう一度 (未選択ならランダム)
playButton.addEventListener("click", () => {
  if (player && userAnimationPlaying()) {
    cancelThinking(); // 停止ボタンで Thinking も止める (繰り返しを再開させない)
    player.stop();
    drawRest();
  } else if (lastAnimation) {
    playAnimation(lastAnimation);
  } else {
    playRandom();
  }
});
pickButton.addEventListener("click", () => fileInput.click());
// 右クリックで、キャラクターを外す (ブラウザのメニューは出さない)
pickButton.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  unloadCharacter();
});
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void pickFile(f);
});

// --- 設定: Groq の API キー (BYOK。ブラウザ内にのみ保存し、サーバーには送らない) ---
const settingsButton = $<HTMLButtonElement>("settings");
const settingsPanel = $("settings-panel");
const groqKeyInput = $<HTMLInputElement>("groq-key");
const groqTestResult = $("groq-test-result");
const groqModelSelect = $<HTMLSelectElement>("groq-model");
const groqPersonaInput = $<HTMLTextAreaElement>("groq-persona");
const GROQ_KEY_STORAGE = "officeagent.groqKey";
const GROQ_MODEL_STORAGE = "officeagent.groqModel";
const GROQ_PERSONA_STORAGE = "officeagent.groqPersona";
const DEFAULT_GROQ_PERSONA = "あなたは Microsoft Office 用アドインに組み込まれたアシスタントです。特に指定がない限り、日本語で簡潔に答えてください。";
let savedGroqModel = "";
try {
  groqKeyInput.value = localStorage.getItem(GROQ_KEY_STORAGE) ?? "";
  savedGroqModel = localStorage.getItem(GROQ_MODEL_STORAGE) ?? "";
  groqPersonaInput.value = localStorage.getItem(GROQ_PERSONA_STORAGE) ?? DEFAULT_GROQ_PERSONA;
} catch {
  groqPersonaInput.value = DEFAULT_GROQ_PERSONA;
}
// 前回選んだモデルがあれば、再取得するまでの間そのまま見えるようにしておく (選べはしない)
if (savedGroqModel) groqModelSelect.replaceChildren(new Option(savedGroqModel, savedGroqModel));

/** 検索エンジンの選択肢の「Groq」表示に、選んでいるモデル名を付け足す */
function updateGroqEngineOptionLabel() {
  groqEngineOption.text = groqModelSelect.value ? `${GROQ_ENGINE_NAME} (${groqModelSelect.value})` : GROQ_ENGINE_NAME;
}
updateGroqEngineOptionLabel();

/** キャラクターの名前・紹介文 (ACS にあれば) をもとに性格 (システムプロンプト) の文面を作る */
function buildGroqPersonaFromCharacter(displayName: string, description: string | undefined): string {
  const intro = description
    ? `あなたは Microsoft Office アシスタントの「${displayName}」です。${description}`
    : `あなたは Microsoft Office アシスタントの「${displayName}」です。`;
  return `${intro} 特に指定がない限り、日本語で簡潔に答えてください。`;
}

/** ユーザーが性格を自分で編集・保存したことがなければ、読み込んだキャラクターの内容で更新する (編集済みなら上書きしない) */
function applyCharacterPersonaIfUnset(displayName: string, description: string | undefined) {
  let customized = false;
  try {
    customized = localStorage.getItem(GROQ_PERSONA_STORAGE) !== null;
  } catch { /* 保存できない環境では、毎回キャラクターの内容で表示する */ }
  if (!customized) groqPersonaInput.value = buildGroqPersonaFromCharacter(displayName, description);
}

$<HTMLButtonElement>("groq-persona-reset").addEventListener("click", () => {
  try {
    localStorage.removeItem(GROQ_PERSONA_STORAGE);
  } catch { /* ignore */ }
  groqPersonaInput.value = currentCharacterDisplayName
    ? buildGroqPersonaFromCharacter(currentCharacterDisplayName, character?.description)
    : DEFAULT_GROQ_PERSONA;
});

/** このセッション中に一度でも疎通確認したか (自動実行を、設定パネルを開くたびに繰り返さないため) */
let groqTestedThisSession = false;

function runGroqTest() {
  groqTestedThisSession = true;
  groqTestResult.textContent = "確認中…";
  groqTestResult.removeAttribute("data-ok");
  void testGroqKey(groqKeyInput.value.trim()).then((result) => {
    groqTestResult.textContent = result.message;
    groqTestResult.title = result.message; // 省略表示されても、ホバーで全文を確認できるように
    groqTestResult.dataset.ok = String(result.ok);
    if (result.models) {
      groqModelSelect.replaceChildren(...result.models.map((m) => new Option(m, m)));
      groqModelSelect.disabled = false;
      // 前回選んでいたモデルが一覧にあれば選び直し、無ければ (モデルの廃止など) 先頭のまま
      if (result.models.includes(savedGroqModel)) groqModelSelect.value = savedGroqModel;
      else groqModelSelect.dispatchEvent(new Event("change"));
      updateGroqEngineOptionLabel();
    }
  });
}

groqModelSelect.addEventListener("change", () => {
  updateGroqEngineOptionLabel();
  try {
    localStorage.setItem(GROQ_MODEL_STORAGE, groqModelSelect.value);
  } catch { /* ignore */ }
});

groqPersonaInput.addEventListener("change", () => {
  try {
    localStorage.setItem(GROQ_PERSONA_STORAGE, groqPersonaInput.value);
  } catch { /* ignore */ }
});

function closeSettings() {
  settingsPanel.hidden = true;
  settingsButton.setAttribute("aria-expanded", "false");
}

settingsButton.addEventListener("click", () => {
  const opening = settingsPanel.hidden;
  settingsPanel.hidden = !opening;
  settingsButton.setAttribute("aria-expanded", String(opening));
  if (opening) {
    groqKeyInput.focus();
    // 保存済みキーがあり、このセッションでまだ確認していなければ、開いた時点で自動的に疎通確認する
    if (!groqTestedThisSession && groqKeyInput.value.trim()) runGroqTest();
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!settingsPanel.hidden && !settingsPanel.contains(e.target as Node) && e.target !== settingsButton) closeSettings();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsPanel.hidden) closeSettings();
});

groqKeyInput.addEventListener("change", () => {
  try {
    localStorage.setItem(GROQ_KEY_STORAGE, groqKeyInput.value.trim());
  } catch { /* ignore */ }
  // 入力し終えた (フォーカスが外れた) タイミングで自動的に疎通確認する
  if (groqKeyInput.value.trim()) runGroqTest();
  else {
    groqTestResult.textContent = "";
    groqTestResult.removeAttribute("data-ok");
  }
});

soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  renderSoundButton();
  if (player) player.soundEnabled = soundOn;
  try {
    localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
  } catch { /* ignore */ }
});

/**
 * Office のテーマ (ダークモードなど) を、配色 (taskpane.html の data-theme) に反映する。
 * ブラウザの prefers-color-scheme は、Office のテーマとは別の設定なので、取れるときは Office の値を優先する。
 */
function applyOfficeTheme() {
  const bg = Office.context?.officeTheme?.bodyBackgroundColor;
  const m = bg && /^#?([0-9a-f]{6})/i.exec(bg);
  if (!m) return;
  const n = parseInt(m[1]!, 16);
  const luminance = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff)) / 255;
  document.documentElement.dataset.theme = luminance < 0.5 ? "dark" : "light";
}

void Office.onReady(async (info) => {
  // Office.HostType.Word は 0 なので、if (info.host) だと Word のときだけ偽になってしまう。undefined と比べる
  const inOffice = info.host !== undefined;
  if (inOffice) applyOfficeTheme();
  officeHostName = inOffice ? hostDisplayName(info.host) : undefined;
  if (inOffice) {
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, onSelectionChanged, (r) => {
      if (r.status !== Office.AsyncResultStatus.Succeeded) {
        setStatus(`選択変更イベントを登録できません: ${r.error.message}`);
      }
    });
    showSelection();
  }
  if (info.host === Office.HostType.Word) {
    watchWordEvents({
      onAnnotationInserted: () => reactTo("Congratulate", "Pleased", "Announce", "GetAttention"),
      onAnnotationRemoved: () => reactTo("Confused", "Decline", "Sad"),
      onParagraphAdded,
    }).catch((e: unknown) => {
      setStatus(`コメント・段落イベントを登録できません: ${(e as Error).message}`);
    });
  }
  if (info.host === Office.HostType.Excel) {
    watchWorksheetActivated(onSheetActivated).catch((e: unknown) => {
      setStatus(`シート切り替えイベントを登録できません: ${(e as Error).message}`);
    });
  }

  const saved = await loadCharacter().catch(() => undefined);
  if (saved) {
    try {
      useCharacter(saved.data, saved.name);
    } catch {
      setStatus("保存済みキャラクターを読み込めませんでした。もう一度選んでください。");
    }
  } else {
    setStatus("キャラクターファイルを選択してください。", "🐬をクリックして、Microsoft Agent のキャラクター (.acs) か、Office 97 のアシスタント (.act) を選択してください");
  }
});
