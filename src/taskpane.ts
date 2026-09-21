import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { buildSearchUrl, SEARCH_ENGINES } from "./search";
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

/** 再生中は ■ (クリックで停止)、待機中は ▶ */
function renderPlayButton(playing: boolean) {
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
  player.onPlayingChange = renderPlayButton;
  renderPlayButton(false);
  const rest = character.animations.get("RestPose") ?? character.animations.values().next().value;
  if (rest?.frames[0]) player.draw(rest.frames[0]);
  status.textContent = name;

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
  eventCount++;
  showSelection();
  const now = Date.now();
  if (now - lastAutoPlay > 4000) {
    lastAutoPlay = now;
    playRandom();
  }
}

// --- ウェブ検索 (検索エンジンの URL をブラウザで開く) ---
const ENGINE_KEY = "officeagent.engine";
engineSelect.replaceChildren(...SEARCH_ENGINES.map((e, i) => new Option(e.name, String(i))));
try {
  engineSelect.value = localStorage.getItem(ENGINE_KEY) ?? "0";
} catch { /* 保存できない環境では既定のまま */ }
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
  playWriting();
});
queryInput.addEventListener("blur", () => {
  focused = false;
  // 途中で切らず、Writing の終了分岐 (書くのをやめる動き) を最後まで再生してから待機ポーズへ
  void player?.release().then(() => {
    // 別のアニメーション (メニュー選択など) が始まっていれば待機ポーズで上書きしない
    if (!focused && !thinking && !player?.isPlaying) drawRest();
  });
});

/** 検索実行時は Thinking を 1 回再生し、終わったらフォーカス中なら Writing に戻る */
function playThinking() {
  const name = firstAnimation("Thinking", "Processing");
  if (!name || !player) return;
  thinking = true;
  void player.play(name).then(() => {
    thinking = false;
    playWriting();
  });
}

function runSearch() {
  const text = queryInput.value.trim();
  const engine = SEARCH_ENGINES[Number(engineSelect.value)];
  if (!text || !engine) return;
  playThinking();
  // ユーザー操作の直後に開く (ポップアップブロック回避)
  const win = window.open(buildSearchUrl(engine, text), "_blank");
  if (win) win.opener = null;
  else status.textContent = "ブラウザに検索ページを開くのをブロックされました。許可してください。";
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
// 再生ボタン: 再生中はクリックで停止して待機ポーズへ。待機中は直前のアニメーションをもう一度 (未選択ならランダム)
playButton.addEventListener("click", () => {
  if (player?.isPlaying) {
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
