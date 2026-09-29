import { watchWorksheetActivated } from "./excel";
import type { DocumentEventHandlers, Host } from "./types";
import { watchWordEvents } from "./word";

function hostDisplayName(host: Office.HostType): string | undefined {
  switch (host) {
    case Office.HostType.Word: return "Microsoft Word";
    case Office.HostType.Excel: return "Microsoft Excel";
    case Office.HostType.PowerPoint: return "Microsoft PowerPoint";
    default: return undefined;
  }
}

/**
 * Office のテーマ (ダークモードなど) の明暗。
 * ブラウザの prefers-color-scheme は、Office のテーマとは別の設定なので、取れるときは Office の値を優先する。
 */
function officeTheme(): "light" | "dark" | undefined {
  const bg = Office.context?.officeTheme?.bodyBackgroundColor;
  const m = bg && /^#?([0-9a-f]{6})/i.exec(bg);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  const luminance = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff)) / 255;
  return luminance < 0.5 ? "dark" : "light";
}

/** Office.js で Office につなぐ。Office の外 (ブラウザで直接開いたなど) なら undefined */
export async function connectOfficeHost(): Promise<Host | undefined> {
  const info = await Office.onReady();
  // Office.HostType.Word は 0 なので、if (info.host) だと Word のときだけ偽になってしまう。undefined と比べる
  if (info.host === undefined || info.host === null) return undefined;
  const host = info.host;

  return {
    name: hostDisplayName(host),
    theme: officeTheme(),

    getSelectedText: () =>
      new Promise((resolve) => {
        Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => {
          resolve(r.status === Office.AsyncResultStatus.Succeeded ? String(r.value ?? "") : "");
        });
      }),

    watchSelection: (handler) =>
      new Promise((resolve, reject) => {
        Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler, (r) => {
          if (r.status === Office.AsyncResultStatus.Succeeded) resolve();
          else reject(new Error(r.error.message));
        });
      }),

    async watchDocument(handlers: DocumentEventHandlers) {
      if (host === Office.HostType.Word) {
        await watchWordEvents({
          onAnnotationInserted: handlers.onCommentAdded,
          onAnnotationRemoved: handlers.onCommentRemoved,
          onParagraphAdded: handlers.onParagraphAdded,
        });
      }
      if (host === Office.HostType.Excel && handlers.onSheetActivated) {
        await watchWorksheetActivated(handlers.onSheetActivated);
      }
    },
  };
}
