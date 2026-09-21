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
const animSelect = $<HTMLSelectElement>("animations");
const playButton = $<HTMLButtonElement>("play");
const queryInput = $<HTMLTextAreaElement>("query");
const balloon = $("balloon");
const engineSelect = $<HTMLSelectElement>("engine");
const fileInput = $<HTMLInputElement>("file");
const soundCheck = $<HTMLInputElement>("sound");

let player: AcsPlayer | undefined;
let character: AcsCharacter | undefined;
/** 選択変更などで連続再生しないための間引き */
let lastAutoPlay = 0;

/** 自動再生に向かない (待機・登場・退場) アニメーションを除く */
const SKIP = /^(Idle|RestPose|Show|Hide|GoodBye|Greet)/i;

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
  player.soundEnabled = soundCheck.checked;
  const rest = character.animations.get("RestPose") ?? character.animations.values().next().value;
  if (rest?.frames[0]) player.draw(rest.frames[0]);
  status.textContent = name;

  const names = [...character.animations.keys()].sort();
  animSelect.replaceChildren(...names.map((n) => new Option(n, n)));
  animSelect.disabled = playButton.disabled = false;
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
    if (!focused && !thinking) drawRest();
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
// VSTO 版と同じく Enter で検索 (Shift+Enter で改行)
queryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    runSearch();
  }
});

/** 吹き出しを閉じる: Writing をやめる動きを再生して待機ポーズへ (blur が担当) */
function closeBalloon() {
  queryInput.blur();
  balloon.hidden = true;
}

function openBalloon() {
  balloon.hidden = false;
  queryInput.focus();
}

$("close").addEventListener("click", closeBalloon);
// VSTO 版と同じく、カイル君をクリックすると検索吹き出しが開く
canvas.addEventListener("click", openBalloon);
playButton.addEventListener("click", () => void player?.play(animSelect.value));
animSelect.addEventListener("change", () => void player?.play(animSelect.value));
$("pick").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void pickFile(f);
});
soundCheck.addEventListener("change", () => {
  if (player) player.soundEnabled = soundCheck.checked;
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
