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

## Office に読み込む（開発用サイドロード）

Office は HTTPS のアドインしか読み込まないため、最初に 1 回だけ開発用証明書を信頼させます（管理者確認のダイアログが出ます）。

```sh
npx office-addin-dev-certs install   # 初回のみ
npm run dev                          # https://localhost:3000 で起動
npm run validate                     # manifest.xml の検証
```

- **Web 版**: Word/Excel/PowerPoint on the web で、[挿入] > [アドイン] > [マイ アドイン] > [カスタム アドインのアップロード] から `manifest.xml` を選ぶ
- **デスクトップ版 (Windows)**: `manifest.xml` を置いた共有フォルダを [信頼できるアドイン カタログ] に登録して読み込む

読み込むと [ホーム] タブの「OfficeAgent」グループに「表示」ボタンが出て、作業ウィンドウにキャラクターが表示されます。
ペインを開くと、キャラクターは最初は見えない状態から、`Greeting`（無いキャラクターは `Show`）のアニメーションで登場します（効果音は、ブラウザの制限で、ペインを一度クリックするまで鳴りません）。
`.acs` は再配布できないので、ペインの「キャラクターを選ぶ」で 1 回選ぶと IndexedDB に保存され、次回から自動で読み込まれます。

## 本番公開 (GitHub Pages)

master に push すると、GitHub Actions（`.github/workflows/deploy.yml`）が自動でビルドして GitHub Pages に公開します。

- 公開先: `https://<ユーザー名>.github.io/OfficeAgent-Web/`
- 本番用のマニフェスト: `https://<ユーザー名>.github.io/OfficeAgent-Web/manifest.xml`（`manifest.xml` の localhost を公開先の URL に置き換えたもの。`npm run build:pages` が `dist/manifest.xml` に生成します）
- 本番用のアドイン ID は、開発用とは別にしてあるので、両方を同じ Office に入れても衝突しません。
- 初回だけ、リポジトリの Settings > Pages > Source を「GitHub Actions」にします。
- ローカルで本番ビルドを試す: `SITE_URL=https://<ユーザー名>.github.io/OfficeAgent-Web npm run build:pages`

## ウェブ検索

吹き出しに入力して [検索(S)]（Enter / Alt+S。Enter で検索すると入力欄のフォーカスが外れます）で、選んだ検索エンジンで検索し、結果を作業ウィンドウ内に表示します。

- **検索エンジン**: Google / Wikipedia。iframe への埋め込みを拒否しない検索先だけを載せています（Yahoo! / YouTube / 楽天 / メルカリなどは拒否するため、ペインには出せません）。
- Google は非公式のパラメーター（`igu=1`）で表示できるだけなので、いつ使えなくなるか、確認画面（reCAPTCHA）が出るかは、環境しだいです。
- **本文の選択範囲を検索に使う**: 本文で文字を選択すると、その内容が吹き出しの入力欄に薄く（プレースホルダーとして）表示されます。先頭に「[Tab]で挿入:」と出て、入力欄が空のとき Tab キーで挿入できます（吹き出しの入力欄では、Tab でフォーカスは移動しません）。
- 結果パネルの「↗」でブラウザで開けます。結果のリンク先は、埋め込みを拒否するサイトが多く、ペイン内に表示できないことがあります。

## ロードマップ

1. ~~ACS パーサ + canvas 再生のプロトタイプ~~（済）
2. ~~タスクペインに表示~~（済） / 吹き出しで AI に質問
3. 選択範囲の要約・翻訳・解説・誤字脱字チェック
4. Excel シート追加や選択変更などのイベント連動アニメ
5. Web Speech API によるノート読み上げ

## 注意

`.acs`（Microsoft Agent キャラクター）は再配布可否を確認するまでリポジトリに含めない。
