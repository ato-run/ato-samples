# Ato でサインインする listmonk（OpenID Connect）

listmonk 6.2.0（公式 `listmonk/listmonk` image）をセルフホストの Ato 上で動かす
サンプルです。Ato の Library から開くと listmonk のログインページになり、そこから
Ato でサインインした状態の listmonk になります。listmonk 自身のアカウントは初回
サインイン時に作られ、メールアドレスには Ato の `email` claim、表示名には Ato の
app account（`preferred_username`、メールアドレスの local part）を使います。既定の
ロールは管理者ではない `Ato user`（lists と subscribers だけ）です。

listmonk 6.2.0 のログインページは OIDC のためだけの画面ではなく、パスワード欄と
OIDC ボタンの両方を出します。自動リダイレクトの設定はないため、Ato でサインイン
するにはその OIDC ボタンを 1 回押します（**追加の 1 クリック**。パスワードは
入力しません）。OIDC で作られるアカウントはパスワードを持たず
（`password_login=false`）、忘れたパスワードの再設定も拒否されるので、通常
ユーザーが listmonk のパスワード経路で Ato を迂回することはできません。

PostgreSQL 15 を同じ image・同じコンテナ・同じ state に同居させています
（portable capsule は filesystem state を 1 つしか持てず、state を 2 つの
サービスで共有できないため）。

## 仕組み

- Ato のセルフホスト Coordinator が OpenID Provider です
  （`<origin>/v1/selfhost/oidc`）。
- `oidc_issuer` Binding（`ato.oidc-issuer@1`）は、listmonk に Runner が持つ relay
  （`ATO_BINDING_OIDC_ISSUER`、コンテナの gateway 上の plain http）を渡します。
- **issuer 一致の問題**: listmonk 6.2.0 は `internal/auth/auth.go` で
  `coreos/go-oidc/v3` v3.14.1 の `oidc.NewProvider` を使います。`NewProvider` は
  discovery 文書の `issuer` が取得に使った URL と**完全一致**することを要求します。
  一方 relay の discovery は `issuer` と `authorization_endpoint` を公開 https の
  まま返し、token・JWKS・userinfo だけを relay に書き換えます。そのため
  - relay を provider URL にすると issuer 不一致で失敗し、
  - 公開 URL を provider URL にすると、コンテナからその https origin に届きません。

  このサンプルは **コンテナ内 loopback の HTTPS front**
  （`image/oidc-relay-proxy.py`）で解きます。listmonk を
  `HTTPS_PROXY=http://127.0.0.1:18443` と `SSL_CERT_FILE`（起動ごとに `/tmp` に作る
  ローカル CA + 公開 issuer ホスト用の証明書）で起動し、listmonk が起動後に出す
  唯一の https 要求（discovery）を proxy に通します。proxy は公開 issuer の
  ホスト名で TLS を終端し、relay へ平文で転送します。discovery 文書自体は改変
  しないので、issuer は設定した公開 URL のままで、id_token の `iss` 検証も
  本来の issuer に対して行われます。**署名検証や issuer 検証は無効化していません。**
- listmonk の OIDC 設定は listmonk 自身と同じく `settings` テーブルに保存します。
  `security.oidc` 行の JSONB（`enabled` / `provider_url` / `provider_name` /
  `client_id` / `client_secret` / `auto_create_users` / `default_user_role_id` /
  `default_list_role_id`）と `app.root_url`、`app.check_updates`、
  `upload.filesystem.upload_path` を毎起動書き込みます。listmonk の
  `get-settings` は `JSON_OBJECT_AGG(key, value)` でこの形式を読みます
  （`queries/misc.sql`）。`security.oidc` の形は `models/settings.go` の
  `json:"security.oidc"` がそのまま保存形式です。
- redirect URI は `<app.root_url>/auth/oidc` です（`cmd/init.go`）。`app.root_url`
  は Instance の公開 origin にするので、Ato の Provider が受け付ける redirect
  origin と一致します。
- 初回サインイン時の自動作成は `auto_create_users=true` で有効にし、既定ロールは
  `Ato user`（`lists:get_all` / `subscribers:get` / `subscribers:get_all` /
  `subscribers:manage`）です。管理者ロール（Super Admin）にはなりません。
  `default_list_role_id` は null です（user role だけで lists/subscribers を扱えます）。
- 管理者の入り方は 2 つです。インストーラが作る `admin` アカウント
  （パスワードは `admin_password` Binding。毎起動 bcrypt ハッシュを再設定するので
  Binding のローテートが効きます）でログインページのパスワード欄から入るか、
  `/api` の API ユーザーを作って使うかです。通常ユーザーはパスワードを持たない
  ため、この経路は Ato を通らない抜け道にはなりません。
- 契約の観測は `/health`（listmonk の未認証ヘルスチェック、200）です。アプリの
  画面は listmonk のセッションか Ato のサインインを要求するため、surface は
  ログインページ `/admin/login`（未認証で 200）にしています。
- state は `/var/lib/listmonk` の 1 つで、`pg/`（PostgreSQL のデータディレクトリ）と
  `uploads/`（listmonk のメディア）が入ります。コードと PostgreSQL のバイナリは
  image の読み取り専用領域です。
- `start.sh` は起動時に PostgreSQL を初期化（初回）・起動し、`listmonk --install
  --idempotent` と `--upgrade` を非対話で実行し、上記の settings を書き、loopback の
  HTTPS front を起動して discovery が公開 issuer と relay の back-channel を指す
  ことを確認してから listmonk を起動します。`/health` が 200 になり、ログインページに
  OIDC フォームがあることを確認して serving になります。どれか欠けると非 0 で
  終了し、Runner が Run を再起動します。
- capsule は 1 step の OCI derivation です。Runner は relay をサービスごとに与える
  ので、Ato は network Binding を宣言した 1 step の route を 1 サービスの group と
  して起動し、そのサービスに `ATO_BINDING_OIDC_ISSUER` を渡します。この動きには
  Coordinator（API）`a250f81c7` 以降と Runner `68de170` 以降が必要です。

## listmonk に適用する設定

| 場所 | キー | 値 |
|---|---|---|
| settings テーブル | `security.oidc` | `enabled=true`, `provider_url=<公開 issuer>`, `provider_name=Ato`, client id/secret（Binding）, `auto_create_users=true`, `default_user_role_id=<Ato user>`, `default_list_role_id=null` |
| settings テーブル | `app.root_url` | Instance の公開 origin |
| settings テーブル | `app.check_updates` | `false`（外部への更新確認をしない） |
| settings テーブル | `upload.filesystem.upload_path` | `/var/lib/listmonk/uploads` |
| config.toml（/tmp） | `app.address` | `0.0.0.0:9000` |
| config.toml（/tmp） | `db.*` | `127.0.0.1:5432`、user/database `listmonk`、`ssl_mode=disable` |
| 環境変数 | `HTTPS_PROXY` | `http://127.0.0.1:18443`（discovery を HTTPS front へ） |
| 環境変数 | `SSL_CERT_FILE` | ローカル CA + システム CA の bundle（/tmp） |

## image を build する

Runner は workload を read-only・非 root（uid 1000）で動かし、`VOLUME` を宣言した
image や ENTRYPOINT 付きの image を受け付けません。公式 listmonk image を digest で
固定し、Debian の PostgreSQL 15 と同居させた image を作り、最後に 1 枚へ平坦化
（`docker export | docker import`）します。

```sh
cd samples/listmonk-ato-oidc

# 公式 image の manifest list とプラットフォームごとの digest（2026-06-26 公開）
#   listmonk/listmonk:v6.2.0  index      sha256:f535d59e14991337a9f2d570273685378ae86b0d7698c3e00da444e3bc205286
#                              linux/amd64 sha256:3089042a786beddb096410da3818b98ce9fe35bdc0a4ad4550f92be674b17291
#                              linux/arm64 sha256:137c35dc989cd8e500fc449b3b86bf405b690d39cb779c0df9a988ed0bd8d7ba
docker buildx imagetools inspect listmonk/listmonk:v6.2.0

LISTMONK_IMAGE=listmonk/listmonk:v6.2.0@sha256:137c35dc989cd8e500fc449b3b86bf405b690d39cb779c0df9a988ed0bd8d7ba \
  ./build-images.sh linux/arm64
# → localhost/ato-e2e/listmonk-flat@sha256:...（digest-pinned な参照）
```

image は uid 1000 のアカウント（`listmonk`）を /etc/passwd に入れています。
Runner は passwd に無い uid で実行するため、これが無いと PostgreSQL の `initdb` が
`could not look up effective user ID 1000` で失敗します。

## capsule.toml を生成する

`capsule.toml` は Instance ごとに変わる値（image 参照、platform、APP_URL、
公開 issuer）を含むので commit せず、`render.sh` で生成します。

```sh
APP_IMAGE=localhost/ato-e2e/listmonk-flat@sha256:...   # build-images.sh の出力
./render.sh "$APP_IMAGE" linux/arm64 "https://cinst-....example" \
  https://selfhost.ato.run/v1/selfhost/oidc > capsule.toml
```

`APP_URL` は、その Instance を Ato の Library から開くときの公開
`https://cinst-...` origin です。listmonk はこの値から redirect URI を作るので、
Instance の実際の origin と一致させる必要があります。Instance を作るまで分から
ないため、下の手順では一度 import して origin を確認してから、同じ Instance を
`update-app` で更新します。`PUBLIC_ISSUER` はインストールの公開 issuer です
（既定は `https://selfhost.ato.run/v1/selfhost/oidc`。ローカル E2E は
`https://ato.localhost/v1/selfhost/oidc`）。

## セルフホスト Ato にインストールする

```sh
# 1. secret Binding を用意する（値を capsule やコマンドラインに出さない）
#    {"oidc_client_id":"listmonk-ato","oidc_client_secret":"<32+ chars>",
#     "db_password":"<32+ chars>","admin_password":"<32+ chars>"}

# 2. 仮の origin で import し、Instance の host を確認する
selfhost upload-bundle "$OWNER" < listmonk.capsule
selfhost import-bundle "$OWNER" "$BUNDLE" --runner "$RUNNER" \
  --bindings-stdin < listmonk.json

# 3. 実際の origin で render し直し、同じ Instance を in-place update する
./render.sh "$APP_IMAGE" linux/arm64 "https://cinst-....example" \
  > capsule.toml
selfhost update-app "$INSTANCE" "$BUNDLE" --allow-stateful-stop --bindings-stdin < listmonk.json

# 4. OIDC client を登録する（secret は stdin）
selfhost set-app-oidc "$INSTANCE" --client-id listmonk-ato \
  --auto email_local --email < client-secret.txt

# 5. organization に共有する
selfhost share-app-with-org "$INSTANCE" "$ORG"
```

## 確認したこと

2026-11-23 にローカルの Lima VM（arm64、linux/arm64、network controls を有効に
した Runner）で確認したこと。Coordinator（API）は `a250f81c7`、Runner は
`68de170` 相当、validator は `9cc4eaf1` の版で行いました。

- digest 固定の公式 listmonk image に Debian の PostgreSQL 15 を入れ、`build-images.sh`
  で平坦化して read-only・非 root（1000:1000）・1 state・64 MB の noexec `/tmp` で
  起動し、`/health` が 200、`/admin/login` に OIDC フォームが出ること。
- 単一 step の OCI route に `ATO_BINDING_OIDC_ISSUER` が注入されること。Instance は
  `/health` の contract を満たして ready になり、`set-app-oidc` の redirect origin が
  Instance の公開 origin と一致すること。
- loopback HTTPS front 経由で listmonk が discovery を取得し、id_token の署名と
  `iss` を公開 issuer に対して検証したうえで、Ato の authorize → callback で
  サインインできること（listmonk のパスワード入力なし。ログインページの OIDC
  ボタン 1 クリック）。
- 2 人の Ato ユーザーによる end-to-end の確認（各自の listmonk ユーザーが
  Ato の email と name で作られ、ロールが `Ato user` で管理者ではないこと、
  subscribers の作成と読み返し、in-place update 後も両方残ること、
  organization から外した人の次のリクエストが 403 になること）は、cookie を
  使い回さずに始めた 1 回の run で最後まで通りました（2026-11-23、Lima VM）。
- in-place update は state を checkpoint / restore して完了し、
  `checkpoint_revision_id`（`isrev_01M820RTYYK90ME89ABJG9K7PC`）が採番されました。
- この run 終了時の state は `du` で 40 MB（`40M`）、checkpoint が pack する
  非圧縮 tar で 42,127,360 bytes でした。上限 64 MiB
  （`MAX_STATE_ARTIFACT_BYTES`）の内側です。
- listmonk の User Role は `Ato user`（id 2）、権限は `lists:get_all` /
  `subscribers:get` / `subscribers:get_all` / `subscribers:manage` で、
  Super Admin ではありませんでした。

## 制限

- 1 Instance = 1 listmonk です。水平スケールはしません。
- Runner は read-only の root filesystem・非 root（本番は 1000:1000）・`/tmp` は
  64 MB の noexec tmpfs で動かします。書き込みは state と `/tmp` だけです。
- listmonk 6.2.0 のログインページにはパスワード欄も残ります。OIDC ボタンの
  1 クリックが要る点と合わせて、ログイン画面の体裁は listmonk の実装に従います。
- state checkpoint は control plane と Runner の両方で 64 MiB までです
  （`ato.state.filesystem@1` の非圧縮 tar）。PostgreSQL の初期化直後で約 29 MB
  （`du`）を使うため、メディアや購読者データが育つと超えます。超えたら
  in-place update の代わりにデータを export して新しい Instance に移してください。
- メールは送りません。SMTP は設定せず、campaign も開始しません。
- listmonk 6.2.0 は RP-initiated logout とロールマッピングを持ちません（v7 の
  改善点）。listmonk の sign-out は listmonk のセッションだけを消し、Ato の
  サインインは残ります。organization から外れた人のアクセスは Ato の gateway が
  403 で止めます。
- listmonk の OIDC client secret は listmonk の settings テーブル（state 内）に
  保存されます。ローテートするときは `set-app-oidc` で更新したうえで Instance を
  再起動してください（`start.sh` は起動時に Binding を読み直します）。
- HTTPS front の証明書と CA は起動ごとに `/tmp` に作り直します（state には残し
  ません）。公開 issuer のホスト名は render 時の `PUBLIC_ISSUER` から決まります。
