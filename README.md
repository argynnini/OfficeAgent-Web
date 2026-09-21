# OfficeAgent-Web

[OfficeAgent](https://github.com/argynnini/OfficeAgent)（VSTO 版カイル君）の Office.js アドイン版。
Word / Excel / PowerPoint / Outlook の Web 版・Mac・モバイルにカイル君を登場させることを目指す実験的プロジェクト。

## 方針

- タスクペイン内にカイル君を常駐させる（デスクトップ版のように画面を歩き回ることは Office.js では不可）
- `.acs` をブラウザで解析し canvas で再生する
- AI 呼び出し（OpenAI / Groq）は API キー露出を避けるためプロキシ経由

## ロードマップ

1. ACS パーサ + canvas 再生のプロトタイプ
2. タスクペインに表示し、吹き出しで AI に質問
3. 選択範囲の要約・翻訳・解説・誤字脱字チェック
4. Excel シート追加や選択変更などのイベント連動アニメ
5. Web Speech API によるノート読み上げ

## 注意

`.acs`（Microsoft Agent キャラクター）は再配布可否を確認するまでリポジトリに含めない。
