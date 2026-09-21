import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { IdleController, isIdleName } from "./idle";
import { buildEmbedUrl, buildSearchUrl, SEARCH_ENGINES } from "./search";
import { loadCharacter, saveCharacter } from "./store";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage");
const status = $("status");
const hostLabel = $("host");
const selectionBox = $("selection");
const selectionInfo = $("selection-info");
const flyout = $("flyout");
const playButton = $<HTMLButtonElement>("play");
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
let character: AcsCharacter | undefined;
/** 選択変更などで連続再生しないための間引き */
let lastAutoPlay = 0;

/** 自動再生に向かない (待機・登場・退場) アニメーションを除く */
const SKIP = /^(Idle|RestPose|Show|Hide|GoodBye|Greet)/i;

let lastAnimation: string | undefined;

/** 自分で再生したアニメーションの再生中か (放置中に勝手に始まる待機動作は含めない) */
const userAnimationPlaying = () => !!player?.isPlaying && !isIdleName(player.currentAnimation);

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

function useCharacter(data: ArrayBuffer, name: string) {
  player?.stop();
  character = new AcsCharacter(data);
  player = new AcsPlayer(character, canvas);
  player.soundEnabled = soundOn;
  player.onPlayingChange = (playing) => {
    renderPlayButton(playing);
    if (!playing) idle.animationEnded();
  };
  renderPlayButton(false);
  // 読み込んだ時点から放置時間を数え直す (直後から深い待機動作が出ないように)
  idle.userActivity();
  const rest = character.animations.get("RestPose") ?? character.animations.values().next().value;
  if (rest?.frames[0]) player.draw(rest.frames[0]);
  // キャラクター名 (ACS に埋め込まれた名前。読めなければファイル名から拡張子を除いたもの) はツールチップに出す
  const displayName = character.name || name.replace(/\.[^.]+$/, "");
  canvas.title = `${displayName}\nクリックでアニメーション`;
  status.textContent = "";

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
    status.textContent = `読み込みに失敗しました: ${(e as Error).message}`;
  }
}

let eventCount = 0;

function showSelection() {
  if (typeof Office === "undefined" || !Office.context?.document) return;
  Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => {
    if (r.status !== Office.AsyncResultStatus.Succeeded) {
      selectionBox.textContent = `選択範囲を取得できません: ${r.error.message}`;
      return;
    }
    const text = String(r.value ?? "");
    selectionBox.textContent = text || "(選択なし)";
    selectionInfo.textContent = `選択変更イベント: ${eventCount} 回 / 取得した文字数: ${text.length}`;
  });
}

function onSelectionChanged() {
  idle.userActivity();
  eventCount++;
  showSelection();
  const now = Date.now();
  if (now - lastAutoPlay > 4000) {
    lastAutoPlay = now;
    playRandom();
  }
}

// --- ウェブ検索 (結果は作業ウィンドウ内に表示する) ---
const ENGINE_KEY = "officeagent.engine";
engineSelect.replaceChildren(...SEARCH_ENGINES.map((e) => new Option(e.name, e.name)));
try {
  // 保存しているのは検索エンジン名。以前の版の番号や、いまは無いエンジン名なら、先頭を選ぶ
  engineSelect.value = localStorage.getItem(ENGINE_KEY) ?? "";
} catch { /* 保存できない環境では既定のまま */ }
if (engineSelect.selectedIndex < 0) engineSelect.selectedIndex = 0;
engineSelect.addEventListener("change", () => {
  try {
    localStorage.setItem(ENGINE_KEY, engineSelect.value);
  } catch { /* ignore */ }
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
for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, () => idle.userActivity());

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

/** 読み込み完了: Thinking を終了分岐で自然に終わらせ、入力中なら Writing、そうでなければ待機ポーズへ */
function stopThinking() {
  if (!thinking) return;
  cancelThinking();
  void player?.release().then(() => {
    if (focused) playWriting();
    else if (!player?.isPlaying) drawRest();
  });
}

// --- 検索結果をペイン内 (iframe) に表示する。埋め込みを拒否するエンジンは別タブで開く ---
const results = $("results");
const resultsFrame = $<HTMLIFrameElement>("results-frame");
const resultsTitle = $("results-title");
/** 「ブラウザで開く」用: 表示中の検索を別タブで開く URL */
let resultsExternalUrl: string | undefined;

function showResults(engineName: string, embedUrl: string, externalUrl: string) {
  resultsExternalUrl = externalUrl;
  resultsTitle.textContent = `${engineName} の検索結果`;
  resultsFrame.src = embedUrl;
  results.hidden = false;
}

function closeResults() {
  results.hidden = true;
  resultsFrame.src = "about:blank";
  resultsExternalUrl = undefined;
}

function openExternal(url: string) {
  // ユーザー操作の直後に開く (ポップアップブロック回避)
  const win = window.open(url, "_blank");
  if (win) win.opener = null;
  else status.textContent = "ブラウザに検索ページを開くのをブロックされました。許可してください。";
}

// 検索結果の読み込みが終わったら Thinking を終える (about:blank への切り替えなど、Thinking 中でなければ何もしない)
resultsFrame.addEventListener("load", stopThinking);
$("results-close").addEventListener("click", closeResults);
$("results-open").addEventListener("click", () => resultsExternalUrl && openExternal(resultsExternalUrl));

function runSearch() {
  const text = queryInput.value.trim();
  const engine = SEARCH_ENGINES.find((e) => e.name === engineSelect.value);
  if (!text || !engine) return;
  playThinking();

  showResults(engine.name, buildEmbedUrl(engine, text), buildSearchUrl(engine, text));
}

$("search").addEventListener("click", runSearch);
// VSTO 版の「検索(&S)」と同じく Alt+S で検索 (ペインにフォーカスがあるときのみ)
document.addEventListener("keydown", (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    runSearch();
  }
});

// VSTO 版と同じく Enter で検索 (Shift+Enter で改行)
queryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    runSearch();
  }
});

// カイル君をクリックするとランダムにアニメーション
canvas.addEventListener("click", playRandom);
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
$("pick").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void pickFile(f);
});
soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  renderSoundButton();
  if (player) player.soundEnabled = soundOn;
  try {
    localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
  } catch { /* ignore */ }
});

void Office.onReady(async (info) => {
  hostLabel.textContent = info.host ? `Office: ${info.host} / ${info.platform}` : "ブラウザ単体で実行中 (Office 外)";

  if (info.host) {
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, onSelectionChanged, (r) => {
      if (r.status !== Office.AsyncResultStatus.Succeeded) {
        selectionInfo.textContent = `選択変更イベントを登録できません: ${r.error.message}`;
      }
    });
    showSelection();
  }

  const saved = await loadCharacter().catch(() => undefined);
  if (saved) {
    try {
      useCharacter(saved.data, saved.name);
    } catch {
      status.textContent = "保存済みキャラクターを読み込めませんでした。もう一度選んでください。";
    }
  } else {
    status.textContent = "「キャラクターを選ぶ」から .acs を選んでください（次回から自動で読み込みます）";
  }
});
