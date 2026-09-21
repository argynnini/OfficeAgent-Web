/** ウェブ検索の検索エンジン一覧 (OfficeAgent 本体の SearchEngines.vb の既定値 + Bing) */
export interface SearchEngine {
  name: string;
  /** 検索語より前の URL */
  prefix: string;
  /** 検索語より後の URL */
  suffix: string;
  /**
   * 作業ウィンドウ内 (iframe) に結果を表示するときの、検索語より前の URL。
   * 指定がなければ、そのエンジンは埋め込みを拒否するので別タブで開く。
   */
  embedPrefix?: string;
}

export const SEARCH_ENGINES: SearchEngine[] = [
  // Google は iframe 表示を拒否する (igu=1 という非公式の回避策は、確認画面 (reCAPTCHA) に止められて当てにならない)
  { name: "Google", prefix: "https://www.google.com/search?q=", suffix: "" },
  { name: "Bing", prefix: "https://www.bing.com/search?q=", suffix: "", embedPrefix: "https://www.bing.com/search?q=" },
  { name: "Yahoo!", prefix: "https://search.yahoo.co.jp/search?p=", suffix: "" },
  { name: "YouTube", prefix: "https://www.youtube.com/search?q=", suffix: "" },
  { name: "ニコニコ動画", prefix: "https://www.nicovideo.jp/search/", suffix: "" },
  { name: "X (Twitter)", prefix: "https://x.com/search?q=", suffix: "" },
  { name: "Googleマップ", prefix: "https://www.google.com/maps/search/", suffix: "" },
  { name: "Amazon", prefix: "https://www.amazon.co.jp/s?k=", suffix: "" },
  { name: "楽天市場", prefix: "https://search.rakuten.co.jp/search/mall/", suffix: "" },
  { name: "ヤフオク！", prefix: "https://auctions.yahoo.co.jp/search/search?p=", suffix: "" },
  { name: "メルカリ", prefix: "https://www.mercari.com/jp/search/?keyword=", suffix: "" },
  // 記事名そのものでなくても検索できるよう、埋め込みでは search= を使う (完全一致なら記事へ移動する)
  { name: "Wikipedia", prefix: "https://ja.wikipedia.org/wiki/", suffix: "", embedPrefix: "https://ja.wikipedia.org/w/index.php?search=" },
];

function encodeQuery(text: string): string {
  return encodeURIComponent(text.replace(/\r?\n/g, " ").trim());
}

/** 別タブ (ブラウザ) で開く URL */
export function buildSearchUrl(engine: SearchEngine, text: string): string {
  return engine.prefix + encodeQuery(text) + engine.suffix;
}

/** 作業ウィンドウ内に表示する URL。埋め込みできないエンジンは undefined */
export function buildEmbedUrl(engine: SearchEngine, text: string): string | undefined {
  return engine.embedPrefix === undefined ? undefined : engine.embedPrefix + encodeQuery(text) + engine.suffix;
}
