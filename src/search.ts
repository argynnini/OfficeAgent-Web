/** ウェブ検索の検索エンジン一覧 (OfficeAgent 本体の SearchEngines.vb と同じ既定値) */
export interface SearchEngine {
  name: string;
  /** 検索語より前の URL */
  prefix: string;
  /** 検索語より後の URL */
  suffix: string;
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { name: "Google", prefix: "https://www.google.com/search?q=", suffix: "" },
  { name: "Yahoo!", prefix: "https://search.yahoo.co.jp/search?p=", suffix: "" },
  { name: "YouTube", prefix: "https://www.youtube.com/search?q=", suffix: "" },
  { name: "ニコニコ動画", prefix: "https://www.nicovideo.jp/search/", suffix: "" },
  { name: "X (Twitter)", prefix: "https://x.com/search?q=", suffix: "" },
  { name: "Googleマップ", prefix: "https://www.google.com/maps/search/", suffix: "" },
  { name: "Amazon", prefix: "https://www.amazon.co.jp/s?k=", suffix: "" },
  { name: "楽天市場", prefix: "https://search.rakuten.co.jp/search/mall/", suffix: "" },
  { name: "ヤフオク！", prefix: "https://auctions.yahoo.co.jp/search/search?p=", suffix: "" },
  { name: "メルカリ", prefix: "https://www.mercari.com/jp/search/?keyword=", suffix: "" },
  { name: "Wikipedia", prefix: "https://ja.wikipedia.org/wiki/", suffix: "" },
];

export function buildSearchUrl(engine: SearchEngine, text: string): string {
  const query = encodeURIComponent(text.replace(/\r?\n/g, " ").trim());
  return engine.prefix + query + engine.suffix;
}
