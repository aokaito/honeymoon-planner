# honeymoon-planner

新婚旅行（HIS 添乗員同行 ロンドン・パリ・ローマ 9日間）のしおりアプリ。
公開URL: https://honeymoon-plan0109.netlify.app/

2人で日程を編集・共有でき、一度開いた内容は電波がなくても表示できます。

## 構成

| 役割 | 使っているもの |
|---|---|
| 画面 | 素の HTML / CSS / JavaScript（ビルド不要） |
| データ・ログイン | Supabase（プロジェクト `honeymoon-planner` / 東京リージョン） |
| 公開 | Netlify（このリポジトリの `main` を push すると自動デプロイ） |
| オフライン | Service Worker（`sw.js`）で画面を、`localStorage` で日程データを端末に保存 |

```
index.html            画面
styles.css            見た目
app.js                動き（ログイン・表示・編集・同期・オフライン）
config.js             Supabase の接続先（公開して問題ない publishable key）
sw.js                 オフライン用 Service Worker（更新したら VERSION を上げる）
vendor/supabase.js    supabase-js v2（UMD 版を同梱。CDN に頼らないため）
manifest.webmanifest  ホーム画面に追加したときのアプリ設定
netlify.toml          Netlify の設定
```

## データベース（Supabase）

- `trip`：出発日（1行だけ）
- `days`：1日ごとの都市・食事・宿泊・ホテル名・メモ
- `items`：予定（日・時刻・タイトル・カテゴリ・場所・URL・メモ。`tour = true` はツアーに含まれる予定）

### 合言葉での利用

ログインは「2人で決めた合言葉」だけです。

- テーブルは RLS 有効・ポリシーなしで、ブラウザから直接は読み書きできません
- 読み書きはすべて合言葉を確認する関数（`get_plan` / `save_item` / `delete_item` / `update_day` / `set_start_date` / `change_passphrase`）を通します
- 合言葉は bcrypt のハッシュだけを `private.passphrase` に保存します
- 10分間に20回間違えると、10分間すべて受け付けなくなります（総当たり対策）
- 合言葉は端末に保存されるので、一度入れれば次からは入力不要です。画面右上の「合言葉を変更」から変えられます

合言葉の初期設定・忘れたときの再設定は、Supabase の SQL Editor で実行します。

```sql
select private.set_passphrase('ここに合言葉');
```

## ローカルで動かす

```sh
python3 -m http.server 8000
# http://localhost:8000 を開く
```

## 旅行前のチェック

- Supabase の無料プランは、1週間アクセスがないとプロジェクトが一時停止します。出発前に一度開いて動くことを確認する（停止していたらダッシュボードで Restore）
- 出発前に2人のスマホでアプリを開き、ホーム画面に追加して、全日程を一度表示しておく（オフライン用の保存がされる）
- 念のため「ツアー情報」タブの「日程をコピー」で、メモアプリにもバックアップしておく
