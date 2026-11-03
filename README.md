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
- `members`：読み書きを許可するメールアドレス

全テーブルで RLS を有効にしていて、`members` に登録されたメールアドレスでログインした人だけが読み書きできます。

### 2人のアカウントを許可する

1. アプリの「はじめての方はこちら」から、それぞれメールアドレスとパスワードで登録し、確認メールのリンクを開く
2. Supabase の SQL Editor で2人のメールアドレスを許可する

```sql
insert into public.members (email) values ('自分のメール'), ('相手のメール');
```

3. 2人とも登録できたら、他の人が登録できないよう Supabase の Authentication → Sign In / Providers で「Allow new users to sign up」をオフにする

## ローカルで動かす

```sh
python3 -m http.server 8000
# http://localhost:8000 を開く
```

## 旅行前のチェック

- Supabase の無料プランは、1週間アクセスがないとプロジェクトが一時停止します。出発前に一度開いて動くことを確認する（停止していたらダッシュボードで Restore）
- 出発前に2人のスマホでアプリを開き、ホーム画面に追加して、全日程を一度表示しておく（オフライン用の保存がされる）
- 念のため「ツアー情報」タブの「日程をコピー」で、メモアプリにもバックアップしておく
