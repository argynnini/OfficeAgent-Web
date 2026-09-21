/**
 * ウェブ検索の検索エンジン。作業ウィンドウ内 (iframe) に結果を表示できるものだけを載せる
 * (Yahoo! / YouTube / 楽天などは、埋め込みを拒否するので載せない)。
 */
export interface SearchEngine {
  name: string;
  /** 別タブ (ブラウザ) で開くときの、検索語より前の URL */
  prefix: string;
  /** 作業ウィンドウ内 (iframe) に表示するときの、検索語より前の URL */
  embedPrefix: string;
}

export const SEARCH_ENGINES: SearchEngine[] = [
  // Google は通常の検索ページの iframe 表示を拒否するが、igu=1 を付けると表示できる (非公式のパラメーターなので、
  // いつ使えなくなるか分からない。ボット判定の確認画面 (reCAPTCHA) が出ることもある。その場合は結果パネルの「↗」でブラウザで開く)
  { name: "Google", prefix: "https://www.google.com/search?q=", embedPrefix: "https://www.google.com/search?igu=1&q=" },
  // 記事名そのものでなくても検索できるよう、search= を使う (完全一致なら記事へ移動する)
  { name: "Wikipedia", prefix: "https://ja.wikipedia.org/w/index.php?search=", embedPrefix: "https://ja.wikipedia.org/w/index.php?search=" },
];

function encodeQuery(text: string): string {
  return encodeURIComponent(text.replace(/\r?\n/g, " ").trim());
}

/** 別タブ (ブラウザ) で開く URL */
export function buildSearchUrl(engine: SearchEngine, text: string): string {
  return engine.prefix + encodeQuery(text);
}

/** 作業ウィンドウ内に表示する URL */
export function buildEmbedUrl(engine: SearchEngine, text: string): string {
  return engine.embedPrefix + encodeQuery(text);
}
