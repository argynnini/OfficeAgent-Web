/**
 * 作業ウィンドウ (taskpane.ts) から見た、キャラクターを載せているアプリ (Office や Google ドキュメントなど)。
 * 作業ウィンドウはこれだけを通してアプリに触り、Office.js などには直接依存しない。
 */
export interface Host {
  /** AI に伝える、実行中のアプリの名前 (例: "Microsoft Word")。わからなければ undefined */
  name?: string;
  /** アプリ側の配色。取れなければ undefined (ブラウザの prefers-color-scheme に任せる) */
  theme?: "light" | "dark";
  /** 本文で選択している文字。選択が無い・取れないときは空文字 */
  getSelectedText(): Promise<string>;
  /** 選択範囲が変わったら handler を呼ぶ。登録できなければ reject する */
  watchSelection(handler: () => void): Promise<void>;
  /** アプリでの操作 (コメントの追加など) を購読する。アプリに無いイベントは無視する。登録できなければ reject する */
  watchDocument(handlers: DocumentEventHandlers): Promise<void>;
}

/** キャラクターが反応する、アプリでの操作 */
export interface DocumentEventHandlers {
  onCommentAdded?: () => void;
  onCommentRemoved?: () => void;
  onParagraphAdded?: () => void;
  onSheetActivated?: () => void;
}
