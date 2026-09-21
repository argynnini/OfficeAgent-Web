import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { loadCharacter, saveCharacter } from "./store";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("stage");
const status = $("status");
const hostLabel = $("host");
const selectionBox = $("selection");
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

function showSelection() {
  if (typeof Office === "undefined" || !Office.context?.document) return;
  Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => {
    if (r.status !== Office.AsyncResultStatus.Succeeded) {
      selectionBox.textContent = `選択範囲を取得できません: ${r.error.message}`;
      return;
    }
    const text = String(r.value ?? "");
    selectionBox.textContent = text || "(選択なし)";
  });
}

function onSelectionChanged() {
  showSelection();
  const now = Date.now();
  if (now - lastAutoPlay > 4000) {
    lastAutoPlay = now;
    playRandom();
  }
}

canvas.addEventListener("click", playRandom);
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
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, onSelectionChanged);
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
