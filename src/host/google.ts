import type { DocumentEventHandlers, Host } from "./types";

/**
 * Google ドキュメント・スプレッドシート・スライドのサイドバー (apps-script/Sidebar.html) に iframe で埋め込まれたときの Host。
 * Google 側には選択の変更や編集のイベントが無いので、Apps Script (apps-script/Code.gs) に一定間隔で状態を問い合わせ、
 * 前回と比べて変わっていたらイベントとして扱う。Apps Script への呼び出しは、親 (Sidebar.html) が postMessage で中継する。
 */

export type GoogleApp = "docs" | "sheets" | "slides";

const APP_NAMES: Record<GoogleApp, string> = {
  docs: "Google ドキュメント",
  sheets: "Google スプレッドシート",
  slides: "Google スライド",
};

export const isGoogleApp = (app: string | null): app is GoogleApp => !!app && app in APP_NAMES;

/** Code.gs の getState() が返すもの */
interface DocumentState {
  /** 選択している文字 */
  selection: string;
  /** ドキュメントの段落の数 (ドキュメントのみ) */
  paragraphs?: number;
  /** 開いているシートの名前 (スプレッドシートのみ) */
  sheet?: string;
}

/** 問い合わせの間隔。Apps Script の呼び出しは 1 回に数百ミリ秒かかるので、短くしすぎない */
const POLL_MS = 2000;
/** 親が応答しないまま待ち続けないようにする上限 */
const CALL_TIMEOUT_MS = 30_000;

let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  const data = e.data as { type?: string; id?: number; result?: unknown; error?: string } | null;
  if (data?.type !== "officeagent:result" || typeof data.id !== "number") return;
  const call = pending.get(data.id);
  if (!call) return;
  pending.delete(data.id);
  if (data.error !== undefined) call.reject(new Error(data.error));
  else call.resolve(data.result);
});

/** 親 (Sidebar.html) を通して、Code.gs の関数を呼ぶ */
function callAppsScript<T>(method: string, ...args: unknown[]): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    // 送るのは関数名と引数だけで秘密は含まないので、親の origin (googleusercontent.com の毎回変わるサブドメイン) は問わない
    window.parent.postMessage({ type: "officeagent:call", id, method, args }, "*");
    window.setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error("Google 側から応答がありません"));
    }, CALL_TIMEOUT_MS);
  });
}

export function connectGoogleHost(app: GoogleApp): Host {
  const selectionHandlers: (() => void)[] = [];
  let docHandlers: DocumentEventHandlers = {};
  let latest: Promise<DocumentState> | undefined;
  let previous: DocumentState | undefined;

  function compare(state: DocumentState) {
    const before = previous;
    previous = state;
    if (!before) return;
    if (state.selection !== before.selection) selectionHandlers.forEach((h) => h());
    if (state.paragraphs !== undefined && before.paragraphs !== undefined && state.paragraphs > before.paragraphs) {
      docHandlers.onParagraphAdded?.();
    }
    if (state.sheet !== undefined && before.sheet !== undefined && state.sheet !== before.sheet) {
      docHandlers.onSheetActivated?.();
    }
  }

  function poll(): Promise<DocumentState> {
    const p = callAppsScript<DocumentState>("getState", app);
    latest = p;
    p.then(compare, () => undefined);
    return p;
  }

  async function loop() {
    // 見えていない (別のタブにいる) 間は問い合わせない
    if (!document.hidden) await poll().catch(() => undefined);
    window.setTimeout(loop, POLL_MS);
  }
  void loop();

  return {
    name: APP_NAMES[app],
    getSelectedText: async () => (await (latest ?? poll())).selection,
    watchSelection: async (handler) => {
      selectionHandlers.push(handler);
    },
    // コメントは、数えるのに Drive API (と広い権限) が要るので、Google 版では扱わない
    watchDocument: async (handlers) => {
      docHandlers = handlers;
    },
  };
}
