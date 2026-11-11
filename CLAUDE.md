# CLAUDE.md — honeymoon-planner

新婚旅行（HIS 添乗員同行「ロンドン・パリ・ローマ 9日間」TI-KLF8030、出発 2027-01-09）のしおりアプリ。
夫婦2人がスマホで日程を見て、細かい予定を書き足していくためのもの。ユーザーとのやり取りは日本語で行う。

- 公開URL: https://honeymoon-plan0109.netlify.app/
- GitHub: aokaito/honeymoon-planner（`main` に push → Netlify が自動デプロイ）
- Supabase: プロジェクト `honeymoon-planner`（ref `ddcxufddayembuiucrne`、東京リージョン、無料プラン）
- 元のツアーページ: https://tour.his-j.com/sp/02A_10/TI-KLF8030/

## 最優先の前提

- **スマホで使う**。390px 幅の iPhone で見やすいことを最優先にする。入力欄は16px以上（iOSで入力時に勝手に拡大されないように）、押す場所は高さ44px以上にする
- **旅先で確実に見られる**こと。オフラインでも、一度開いた日程は表示できるようにしておく（後述）
- ビルド工程はない。素の HTML / CSS / JavaScript。フレームワークや npm 依存を足さない

## ファイル構成

```
index.html            画面（ログイン / 日程 / ツアー情報 / 設定 / 編集シート / 合言葉変更シート）
styles.css            見た目（CSS変数で配色を管理）
app.js                動き（表示・日付切り替え・スワイプ・編集・同期・オフライン・合言葉）
config.js             Supabase の URL と publishable key（公開して問題ないキー）
sw.js                 Service Worker（画面ファイルを端末に保存）
vendor/supabase.js    supabase-js v2 の UMD 版を同梱（CDNに頼らないため）
manifest.webmanifest  ホーム画面に追加したときの設定
icons/                アプリアイコン（緑・ピンク・ブラウンの円3つ）
netlify.toml          publish = "."、sw.js は no-cache
```

## 認証：合言葉方式（メール＋パスワードはやめた）

最初は Supabase Auth のメール＋パスワードだったが、次の理由でやめた。

- Supabase 標準のメール送信は1時間に2通まで。確認メールとパスワード再設定がすぐ上限に当たった
- Site URL の設定漏れで、メールのリンクが localhost に飛んだ

今は **2人で共有する合言葉1つ**で使う。

- テーブル（`trip` / `days` / `items`）は **RLS 有効・ポリシーなし**。ブラウザから直接は読み書きできない
- 読み書きはすべて、合言葉を確認する SECURITY DEFINER 関数を `sb.rpc()` で呼ぶ
  - `get_plan(p)` → `{trip, days, items}`
  - `save_item(p, item jsonb)`（`item.id` が空なら追加、あれば更新。`tour` は更新しない）
  - `delete_item(p, item_id uuid)`
  - `update_day(p, day_n, new_hotel, new_note)`
  - `set_start_date(p, d date)`
  - `change_passphrase(p, new_p)`（6文字以上）
- 合言葉が違うときなどは、例外ではなく `{error: 'invalid' | 'not_set' | 'locked' | 'too_short'}` を返す（例外を投げると、失敗の記録までロールバックされてしまうため）
- 合言葉は `private.passphrase` に bcrypt のハッシュだけを保存する。`private` スキーマは API に公開していない
- 総当たり対策：`private.failed_attempts` に失敗を記録し、10分間に20回間違えると10分間 `locked` を返す
- ブラウザ側は合言葉を `localStorage`（`honeymoon-pass`）に保存し、次回から入力不要にしている
- Supabase のセキュリティ診断で「anon が SECURITY DEFINER 関数を実行できる」という警告が出るが、上の設計どおりなので意図したもの
- 合言葉の設定・忘れたときの再設定は、ユーザーが SQL Editor で実行する（合言葉は Claude に教えてもらわない）
  ```sql
  select private.set_passphrase('合言葉');
  ```
- Supabase Auth には昔のユーザー（メールアドレス）が1件残っているが、もう使っていない

## データ

- `trip`：1行だけ（`id = 1`）。`start_date` は 2027-01-09
- `days`：`n`（1〜9）、`city`（`lon` / `par` / `rom` / `move`）、`route`、`stay`、`meals` jsonb（`{b,l,d}`。値が `"付"` なら付きという意味、それ以外は料理名）、`hotel`、`note`
- `items`：`id` uuid、`day`、`time` / `end_time`（`"HH:MM"` または空文字）、`title`、`cat`（`sight` / `food` / `move` / `shop` / `rest` / `other`）、`place`（Googleマップ検索のリンクに使う）、`url`、`note`、`tour`（ツアーに含まれる予定なら true）、`sort_order`
- 最初のデータはツアーページの内容から作った。ユーザーが追加した予定は `tour = false`
- スキーマを変えるときはマイグレーションで行い、変更後に `get_advisors(security)` で確認する

## 同期とオフライン

- 保存したら、Realtime の broadcast（`honeymoon-sync` チャンネル、`changed` イベント）で「変わった」という合図だけを送る。受け取った側は `get_plan` を呼び直す。データ自体は流さない
- 合図を取りこぼしたときのため、画面が表示されている間は60秒ごとと、画面が前面に戻ったときにも取り直す
- 取得した日程は `localStorage`（`honeymoon-cache-v1`）に保存する。圏外のときはこれを表示し、編集はできない状態（`body.readonly`）にする
- `sw.js` は画面ファイルとフォントを端末に保存する。**画面ファイルを変えたら `sw.js` の `VERSION` を必ず上げる**（今は `v6`）。上げないと、利用者の端末に古い画面が残る
- 選んでいる日は `localStorage`（`honeymoon-day`）に保存する。旅行中は、開いたときにその日を表示する

## UI（スマホ向けに作り直したもの）

- 上部：タイトル「新婚旅行のしおり」＋「出発まで○日」、その下に横スクロールの日付チップ（DAY n / 日付 / 曜日、都市の色の線）
- 日程タブ：**1日ずつ表示**する。上に都市の色のカード（DAY・日付・行程・朝昼夕食・宿泊ボタン・その日のメモ）、その下に「スケジュール」（時刻あり）と「時間未定」の予定カードをタイムライン形式で並べる。最後に前の日・次の日ボタン。左右のスワイプでも日を切り替えられる
- 右下の丸い＋ボタン：表示している日に予定を追加する
- 下部のタブ：日程 / ツアー情報 / 設定（出発日・同期状況・バックアップのコピー・合言葉の変更・ログアウト）
- 編集は下から出るシート。タイトルと閉じるボタンを上、保存ボタンを下に固定。カテゴリはボタンで選ぶ

### 配色（ユーザー指定のパレット）

| 名前 | 色 | 主な使い道 |
|---|---|---|
| ピンク | `#e89e95` | パリの色、追加ボタン、アクセント |
| 白 | `#f5efe6` | 背景 |
| ブラウン | `#8a7468` | ローマの色、主なボタン、補足の文字 |
| 緑 | `#a9b8a3` | ロンドンの色 |
| 薄ピンク | `#e7c8c2` | 移動日の色、枠線や印 |

本文の文字は読みやすさのため `#4a3d36`。ローマの色（ブラウン）の上だけ白い文字にする（`data-light="0"`）。フォントは Noto Sans JP、見出しは Shippori Mincho。

## 動作確認の方法

- Claude のクラウド作業環境からは `supabase.co` と `netlify.app` に接続できないことが多い。その場合は、`vendor/supabase.js` を偽物（`rpc()` と `channel()` だけを持つ）に差し替えて、Playwright で 390×844 の画面を表示して確認する
- DB側の関数は Supabase MCP の `execute_sql` で確かめる。テストで作ったデータは消しておく。`private.passphrase` を上書きしない
- 本番データの中身は `execute_sql` で直接見られる（合言葉は不要）

## 運用メモ

- Supabase の無料プランは、1週間アクセスがないとプロジェクトが一時停止する。出発前に一度開いて、動くことを確認してもらう
- 出発前に、2人のスマホで全日程を一度表示しておいてもらう（オフライン用の保存のため）
- service_role key などの秘密の情報はリポジトリに入れない。`config.js` に置くのは publishable key だけ
- コミットは `main` に直接 push している（夫婦2人用の小さなアプリのため）
