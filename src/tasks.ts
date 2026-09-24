/**
 * Groq (AI) に頼む作業の種類。質問ボタンの ▾ メニューで選ぶ。
 * 「質問」以外は、入力欄が空なら本文の選択範囲を対象にする。
 */
export interface AiTask {
  id: string;
  /** ボタンに出す短い名前 (吹き出しのボタン幅に収まるよう 2 文字) */
  label: string;
  /** メニューに出す説明 */
  description: string;
  /** Groq に送る依頼文を作る */
  build(text: string): string;
}

/** 依頼文と対象の文章を区切る (対象の中の指示に、依頼文が上書きされにくいように) */
const quote = (text: string) => `\n\n"""\n${text}\n"""`;

export const AI_TASKS: readonly AiTask[] = [
  {
    id: "ask",
    label: "質問",
    description: "入力した内容をそのまま質問",
    build: (text) => text,
  },
  {
    id: "summarize",
    label: "要約",
    description: "要点を短くまとめる",
    build: (text) => `次の文章を要約してください。要点を箇条書きで短くまとめてください。${quote(text)}`,
  },
  {
    id: "translate",
    label: "翻訳",
    description: "日本語 ⇔ 英語に訳す",
    build: (text) =>
      `次の文章を翻訳してください。日本語の文章なら英語に、それ以外の言語なら日本語に訳し、訳文だけを返してください。${quote(text)}`,
  },
  {
    id: "explain",
    label: "解説",
    description: "わかりやすく説明する",
    build: (text) =>
      `次の内容を、専門知識がない人にもわかるように解説してください。用語や背景も必要に応じて補ってください。${quote(text)}`,
  },
  {
    id: "proofread",
    label: "校正",
    description: "誤字脱字・文法の誤りをチェック",
    build: (text) =>
      "次の文章の誤字脱字や文法の誤りを確認してください。" +
      "誤りがあれば、該当箇所と修正案を箇条書きで示し、最後に修正後の全文を示してください。" +
      `誤りがなければ「誤りは見つかりませんでした」とだけ答えてください。${quote(text)}`,
  },
];

export const DEFAULT_AI_TASK = AI_TASKS[0]!;

export const findAiTask = (id: string | null | undefined): AiTask =>
  AI_TASKS.find((t) => t.id === id) ?? DEFAULT_AI_TASK;
