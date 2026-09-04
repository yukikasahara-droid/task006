# クイックタスク

納期が近い順に自動で並ぶ、**見やすさ最優先**のシンプルなタスク管理アプリです。
ビルド不要の静的サイト（HTML + CSS + JavaScript のみ）なので、ファイルを開くだけで動きます。

## 特長
- ⚡ すぐ追加（タイトル・納期・ジャンル / Enterキーでも追加）
- 📅 納期の近い順に自動並べ替え（「今日」「明日」「◯日超過」を表示）
- 🏷️ ジャンルで絞り込み・ジャンルの追加/削除
- ✅ 完了チェック・削除
- 📝 タスクごとに備考（詳細メモ）を任意で追加・編集（自動保存）
- 👀 見やすい設計：大きめ文字・高コントラスト・ライト/ダーク自動対応
- ♿ 基本のアクセシビリティ：意味のあるHTML・キーボード操作・読み上げ対応
- 💾 データはブラウザ内（localStorage）に保存。サーバー不要

## ファイル構成
```
task006/
├── index.html                    画面の骨組み（意味のあるHTML）
├── css/
│   └── style.css                 見た目（色・文字・レイアウト。先頭の「トークン」で調整可）
├── js/
│   ├── store.js                  データ係（保存・読込・日付や並べ替えの計算）
│   └── app.js                    画面係（描画とユーザー操作）
├── .github/workflows/deploy.yml  push すると自動で Web 公開
└── README.md                     このファイル
```

## 手元で見る
`index.html` をダブルクリックしてブラウザで開くだけです（インストール作業なし）。

## Web に公開する（GitHub Pages）
`main` ブランチに push すると、GitHub Actions が自動で Pages を有効化して公開します。
公開先URL: `https://yukikasahara-droid.github.io/task006/`

> 初回のみ、リポジトリの **Settings → Actions → General → Workflow permissions** が
> 「Read and write permissions」になっている必要があります（通常は既定でOK）。

## カスタマイズのヒント
- **色や文字サイズ** … `css/style.css` の先頭 `:root { --... }` の値を変更
- **初期ジャンル** … `js/store.js` の `DEFAULT_CATEGORIES`
- **並べ替えルール** … `js/store.js` の `sortTasks`
