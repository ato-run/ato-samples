# Ato のゲートウェイ越しに使う Uptime Kuma（チーム共有ダッシュボード）

Uptime Kuma 2.5.12（公式 `louislam/uptime-kuma` image）をセルフホストの Ato 上で
動かすサンプルです。1 つの Instance が 1 チームの共有ダッシュボードになります。
Ato の Library から Instance を開ける人は全員、同じモニターを見て編集できます。

Uptime Kuma の stable 2.x には OIDC・ヘッダー認証・個人アカウントがなく、SSO で
Ato のサインインに接続できません。そのためこのサンプルは、Uptime Kuma 自身の
ログインを切って **Ato のアプリゲートウェイだけを入口** にします。詳しくは
「なぜ Uptime Kuma のログインを切るのか」を読んでください。

## なぜ Uptime Kuma のログインを切るのか

- Uptime Kuma 2.5.12 の認証は username/password（+ 2FA）だけで、OIDC は
  v3.0.0-beta 以降の開発中の実装です。stable に Ato のアカウントを持ち込む
  手段がないため、ログイン画面を残すと「Ato でサインインしたのに、さらに
  Uptime Kuma の別パスワードが要る」という二重ログインになります。
- そこで設定 `disableAuth=true` にします。Uptime Kuma のサーバーは Socket.IO の
  接続ごとにこの設定を読み、最初の管理ユーザーとして自動サインインして
  `autoLogin` を返します（`server/server.js`）。UI はログインフォームを出さず、
  そのままダッシュボードになります。
- **この構成が安全なのは、Instance が Ato のアプリゲートウェイからしか開けない
  ときだけです。** Ato のゲートウェイは、organization のメンバーでない人の
  リクエストを 403 で拒否し、削除後に開き直すと 404 を返します（このサンプルの
  検証項目でもあります）。つまりアクセス制御は Ato 側にあります。
- そのため、この image を直接公開したり、ゲートウェイを通さずホストポートに
  出したりしてはいけません。capsule はホストポートを公開せず、image も Ato の
  Runner 上でだけ動かす前提です。ゲートウェイなしで動かすと、Uptime Kuma の
  ダッシュボードは誰でも読み書きできます。

## 仕組み

- capsule は 1 step の OCI derivation です。Uptime Kuma の Node サーバー
  （`server/server.js`）1 プロセスが、ビルド済み UI（`dist/`）、Socket.IO API、
  モニターの実行を兼ねます。
- コードは image の読み取り専用領域（`/app`）にあり、この workspace は
  `/workspace` に read-only でマウントされます（image の `/app` を隠さない
  ため、既定の `/app` ではなく `/workspace` にしています）。Runner は非 root
  （本番は uid 1000）で起動し、書き込み先は state と `/tmp` だけです。
- state は `/data` の 1 つです。SQLite の `kuma.db`、`upload/`、
  `screenshots/`、`error.log`、`db-config.json` が入ります。公式 image は
  embedded MariaDB も同梱していますが、このサンプルは SQLite だけを使います
  （`UPTIME_KUMA_DB_TYPE=sqlite` を明示し、`UPTIME_KUMA_ENABLE_EMBEDDED_MARIADB`
  は外します）。
- **初回のセットアップは人が行いません。** Uptime Kuma は初回起動時に
  「データベースの種類を選ぶ」ページと「最初の管理ユーザーを作る」ページ
  （Socket.IO の `setup` イベント）を出します。`start.sh` はサーバーを起動する前に
  `database-init.js` を実行し、次の 2 つを行います。
  - image の `db/kuma.db`（テンプレート）を state にコピーする
    （`server/database.js` の `Database.connect()` と同じ動き）。
  - 管理ユーザーを 1 行作る（`setup` イベントと同じ、image 同梱の bcryptjs で
    10 rounds のハッシュ）。パスワードは `admin_password` Binding
    （`ato.secret@1`、必須）から受け取り、**表示も保存もしません**。
- **起動のたびに設定を戻します。** `database-init.js` は毎回、次を書き込みます。
  - `disableAuth=true` — Uptime Kuma のログインを切る（上記）。
  - `keepDataPeriodDays=3` — ハートビートと日次統計の保持期間。3 日を選んだ理由は
    「state を 64 MiB の checkpoint の内側に保つ」ためです。履歴は
    `server/jobs/clear-old-data.js` がこの期間で削除し、非重要な
    heartbeat は直近 24 時間ぶんだけ残します。
  - `checkUpdate=false` — `https://uptime.kuma.pet/version` への更新確認を止める。
    この Instance は image の取得と、自分自身（127.0.0.1）へのモニター以外に
    外へ通信しません。通知プロバイダーは 1 つも設定しません。
- `state-check.js` はサーバー起動後に、UI と同じ Socket.IO 接続で
  `autoLogin` が返ること（= Uptime Kuma のログインが有効になっていないこと）と、
  `getSettings` が上の 3 つの設定を返すことを確認します。どれか欠けると
  `start.sh` は Run を非 0 で終了し、Runner が再起動します。
  （Ato のゲートウェイが唯一の入口である、という前提が崩れた状態で
  serving を続けないためです。）
- UI は Socket.IO（Engine.IO v4）でダッシュボードを読み書きします。Ato の
  ゲートウェイ越しの Socket.IO セッション（socket.io-client が最初に使う
  polling トランスポート）で、`autoLogin` とモニター一覧が届き、モニターの
  追加・履歴の表示ができます。**WebSocket への upgrade は、この検証に使った
  セルフホストの版では Ato のアプリプロキシが 502
  （`instance_upstream_unreachable`）で拒否しました。** 同じ upgrade を
  Runner の app forwarder に直接送ると 101 で通り、アプリ側は WebSocket を
  受け付けます（「確認したこと」と「制限」を参照）。UI は upgrade が失敗すると
  polling のまま動くため、ダッシュボードの操作は成立します。
- 契約の観測は `/dashboard`（200、サインイン不要）です。Uptime Kuma の `/` は
  `/dashboard` への 302 だけなので、実際のページである `/dashboard` を観測します。
  ログインは要求されません。

## 実装に合わせた設定

| 場所 | 値 | 意味 |
|---|---|---|
| `admin_password` Binding（`ato.secret@1`） | 32 文字以上を推奨 | 最初の管理ユーザーのパスワード。初回だけ使う。表示しない |
| `UPTIME_KUMA_DB_TYPE` | `sqlite` | SQLite を明示（DB 選択ページを出さない） |
| `UPTIME_KUMA_ENABLE_EMBEDDED_MARIADB` | （外す） | 公式 image の embedded MariaDB を使わない |
| `DATA_DIR` | `/data/` | Uptime Kuma のデータディレクトリ（state） |
| `PORT` / `UPTIME_KUMA_PORT` | `3001` | Surface の app.http |
| `keepDataPeriodDays`（setting） | `3` | heartbeat / stat_daily の保持日数 |
| `disableAuth`（setting） | `true` | Uptime Kuma のログインを切る |
| `checkUpdate`（setting） | `false` | 更新確認の外部通信を止める |

## image を build する

Runner は workload を read-only・非 root で動かし、`VOLUME` や ENTRYPOINT を
宣言した image を受け付けません。このサンプルは公式 image を digest で固定して
1 枚に平坦化するだけで、追加の Dockerfile はありません（公式 image が Node 22、
ビルド済み UI、SQLite テンプレートを含みます）。image は `VOLUME` を宣言して
いません。平坦化のときに ENTRYPOINT（dumb-init）を外し、`USER 1000:1000`
（image の node ユーザー）にします。

```sh
cd samples/uptime-kuma-ato-gateway

# 公式 image の manifest list とプラットフォームごとの digest（2026-11-17 公開）
#   louislam/uptime-kuma:2.5.12  index        sha256:8e4b6bef96417ec98a35dc103c99cc64fc229a01e584e56d95d9004d2003c02a
#                                linux/amd64  sha256:bc81e600a1b18824e7eaecbb0167c2a1c732475fc499c1e3253752b965946036
#                                linux/arm64  sha256:e505afc2d098dd4b745ff523d6fed7442ea280ab8a7bca2ee5887267d5491e39
docker buildx imagetools inspect louislam/uptime-kuma:2.5.12

UPTIME_KUMA_IMAGE=louislam/uptime-kuma:2.5.12@sha256:e505afc2d098dd4b745ff523d6fed7442ea280ab8a7bca2ee5887267d5491e39 \
  ./build-images.sh linux/arm64
# → localhost/ato-e2e/uptime-kuma-flat@sha256:...（digest-pinned な参照）
```

## capsule.toml を生成する

`capsule.toml` は Instance ごとに変わる image 参照と platform を含むので commit
せず、`render.sh` で生成します。このアプリは公開 URL（redirect URI や自分の
絶対 URL）を必要としないため、`render.sh` に URL の引数はありません。

```sh
APP_IMAGE=localhost/ato-e2e/uptime-kuma-flat@sha256:...   # build-images.sh の出力
./render.sh "$APP_IMAGE" linux/arm64 > capsule.toml
```

## セルフホスト Ato にインストールする

```sh
# 1. admin_password は値を見せずに JSON で渡す
#    {"admin_password":"<32+ chars>"}
#    （例: head -c 32 /dev/urandom | base64 などで作り、ファイルは 0600 にする）

# 2. bundle を作って import する
selfhost upload-bundle "$OWNER" < uptime-kuma.capsule
selfhost import-bundle "$OWNER" "$BUNDLE" --runner "$RUNNER" \
  --bindings-stdin < bindings.json

# 3. organization に共有する（この Instance を開ける人は全員同じダッシュボード）
selfhost share-app-with-org "$INSTANCE" "$ORG"
```

Uptime Kuma 自身の identity（OIDC・ヘッダー identity）は使いません。
`share-app-with-org` だけで、Instance を開けるかどうかが Ato 側の権限になります。

## 確認したこと

2026-11-23 にローカルの Lima VM（arm64、linux/arm64、1 Run per Runner）で、
上の image を build し、bundle を pack / import して organization に共有し、
1 回の run で次を確認しました（数値はこの run の実測です）。

- 2 人（bob / carol）が Library から開くと、Uptime Kuma のログインフォームなしに
  ダッシュボードへ到達すること。HTML の 200 だけでなく、UI と同じ Socket.IO
  （Engine.IO v4）接続で `autoLogin` とモニター一覧が届くことで確認しました。
  upgrade が通らないため、この接続は socket.io-client の初期トランスポートで
  ある polling です（下の「検出した不一致」を参照）。
- bob が 127.0.0.1:3001 への HTTP モニターを追加し、carol のダッシュボードに
  同じモニターが出ること（同じ管理ユーザーとして共有される）。ハートビートも
  記録されました。
- README だけを変えた bundle への in-place update が state を checkpoint /
  restore して完了し（`state: completed`、checkpoint あり）、モニターと
  ハートビート履歴（beats）が残ること。
- organization から carol を外すと、開いていたセッションの次のリクエストが 403、
  開き直しが 404 になること。bob は引き続き使えること。carol を戻すと再び
  開けること。
- state は Instance を停止した後で `du` が約 300 KiB、checkpoint が pack する
  非圧縮 tar が 296,960 bytes でした。上限 64 MiB
  （`MAX_STATE_ARTIFACT_BYTES`）の内側です。

### 検出した不一致（WebSocket の upgrade）

Ato のゲートウェイ越しの Socket.IO 接続で、WebSocket への upgrade は
**Ato のアプリプロキシが 502（`instance_upstream_unreachable`）で拒否**しました。
Instance を `always_on/running` にして（コンテナ稼働中）試しても同じで、
同じ upgrade を Runner の app forwarder に直接送ると 101 Switching Protocols と
Engine.IO の open packet が返り、アプリ側（Uptime Kuma）は WebSocket を
受け付けています。つまり、この検証に使ったセルフホストの版では app proxy が
WebSocket upgrade を上流へ渡せていません（Grist のサンプルが websocket で
動くという前提とは食い違います）。UI は upgrade に失敗すると polling のまま
動き続けるため、ダッシュボードの操作（ログインなしの autoLogin、モニターの
追加・履歴）は polling で成立します。この点はサンプル側の問題ではなく
プラットフォーム側の不一致として報告します。

## 制限

- **個人アカウントはありません。** 1 Instance = 1 チームの共有ダッシュボードで、
  開ける人は全員、モニターの追加・変更・削除ができます。誰が何を変えたかの
  監査ログもありません。
- この検証環境では Socket.IO の WebSocket upgrade が Ato のアプリプロキシで
  502 になり、UI は polling トランスポートで動きます（「検出した不一致」）。
  この Instance を開く人のブラウザでも同じ挙動になります。
- Uptime Kuma 自身のログインは切りっぱなしです（毎起動 `disableAuth=true` に
  戻します）。UI の Settings から有効にしても、次の再起動で戻ります。
  管理ユーザーのパスワードは初回作成のみに使い、通常は使いません。
- state checkpoint は 64 MiB までです。保持期間を 3 日にしているのはこのためで、
  3 日より古い履歴は消えます。モニター数や監視間隔を増やすと 3 日でも
  超え得るので、その場合は保持期間を短くするか、checkpoint ではなく
  データを export して新しい Instance に移してください。
- 通知プロバイダーは 1 つも設定していません。この Instance は通知を送りません。
  監視対象は Instance 自身（127.0.0.1）だけです。
- 外部への更新確認は `checkUpdate=false` で止めています。
- このサンプルは 1 Instance = 1 Uptime Kuma です。水平スケールしません。
- image のテストは arm64 のみです。amd64 の digest は同じ tag の manifest から
  固定していますが、amd64 の Runner での build・import・E2E は未検証です。
- Uptime Kuma は HTTP で待ち受け、TLS は Ato のゲートウェイが終端します。