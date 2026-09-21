# OfficeAgent-Web

[OfficeAgent](https://github.com/argynnini/OfficeAgent)（VSTO 版カイル君）の Office.js アドイン版。
Word / Excel / PowerPoint / Outlook の Web 版・Mac・モバイルにカイル君を登場させることを目指す実験的プロジェクト。

## 方針

- タスクペイン内にカイル君を常駐させる（デスクトップ版のように画面を歩き回ることは Office.js では不可）
- `.acs` をブラウザで解析し canvas で再生する
- AI 呼び出し（OpenAI / Groq）は API キー露出を避けるためプロキシ経由

## プロトタイプの使い方

```sh
npm install
npm run dev      # ブラウザで .acs を選択（またはドラッグ&ドロップ）して再生
npm run dump -- path/to/Merlin.acs                      # 解析結果と全画像の展開チェック
npx tsx scripts/render.ts path/to/Merlin.acs RestPose out.png   # 先頭フレームを PNG 出力
```

現状: ACS のパース（キャラクター情報・アニメーション・画像）、独自圧縮の展開、canvas での再生（分岐あり）まで。
未対応: 口パク（overlay）、サウンド、終了分岐、状態（States）。

## ロードマップ

1. ~~ACS パーサ + canvas 再生のプロトタイプ~~（済）
2. タスクペインに表示し、吹き出しで AI に質問
3. 選択範囲の要約・翻訳・解説・誤字脱字チェック
4. Excel シート追加や選択変更などのイベント連動アニメ
5. Web Speech API によるノート読み上げ

## 注意

`.acs`（Microsoft Agent キャラクター）は再配布可否を確認するまでリポジトリに含めない。
