# Ato でサインインする Gatus（OpenID Connect）

Gatus 5.38.0（公式 `twinproduction/gatus` image のバイナリ）をセルフホストの Ato 上で
動かすサンプルです。Gatus は 1 Instance に 1 つの共有ダッシュボードしか持ちません
（アカウント・個人データの概念がない）。このサンプルは「チームに 1 枚の監視画面」として
使い、ダッシュボード全体を Ato のサインインで守ります（2026-11-23 の判断）。

Ato の Library から開くと Gatus のログイン画面（「Login with OIDC」ボタン）になり、
そのボタンを 1 回押すと Ato の authorize → Instance の `/authorization-code/callback`
でサインインしてダッシュボードになります。Gatus にパスワードはありません。Ato の
gateway は organization のメンバーだけを通すので、**ダッシュボードを見られるのは
その Instance を共有された organization のメンバーだけ**です。

Gatus は OIDC の自動リダイレクトを持たず、未サインインのブラウザには SPA の
ログイン画面を 200 で返します。そのため最初の表示からダッシュボードまでは
**追加の 1 クリック**が要ります。

## 仕組み

- Ato のセルフホスト Coordinator が OpenID Provider です
  (`<origin>/v1/selfhost/oidc`)。
- `oidc_issuer` Binding（`ato.oidc-issuer@1`）は、Gatus に Runner が持つ relay
  （`ATO_BINDING_OIDC_ISSUER`、コンテナの gateway 上の plain http）を渡します。
- **issuer 一致の問題**: Gatus 5.38.0 は `security/oidc.go` で
  `coreos/go-oidc/v3` の `oidc.NewProvider` を使います。`NewProvider` は
  discovery 文書の `issuer` が取得に使った URL と**完全一致**することを要求します。
  一方 relay の discovery は `issuer` と `authorization_endpoint` を公開 https の
  まま返し、token・JWKS・userinfo だけを relay に書き換えます。そのため
  - relay を issuer URL にすると issuer 不一致で起動時に panic し、
  - 公開 URL を issuer URL にすると、コンテナからその https origin に届きません。

  このサンプルは **コンテナ内 loopback の HTTPS front**
  （`image/oidc-relay-proxy.py`）で解きます。Gatus を
  `HTTPS_PROXY=http://127.0.0.1:18443` と `SSL_CERT_FILE`（起動ごとに `/tmp` に作る
  ローカル CA + 公開 issuer ホスト用の証明書）で起動し、Gatus が起動時に出す
  唯一の https 要求（discovery）を front に通します。front は公開 issuer のホスト名で
  TLS を終端し、relay へ平文で転送します。discovery 文書自体は改変しないので
  issuer は設定した公開 URL のままで、id_token の署名と `iss` 検証も本来の
  issuer に対して行われます。**署名検証や issuer 検証は無効化していません。**
- Gatus が要求する claim は id_token の `sub` だけです（`security/oidc.go` は
  `allowed-subjects` を `sub` と比較し、空なら全 subject を許可します）。Ato の
  `sub` はインストール secret から Instance とユーザーごとに導く不透明な値なので、
  人を列挙する `allowed-subjects` には向きません。このサンプルは
  `allowed-subjects` を空にして、**メンバー判定を Ato の gateway と organization に
  一本化**します（最も驚きの少ない設定）。Gatus 側にはユーザー概念がないので、
  organization から外れた人は次のリクエストから Ato の gateway が 403 で止めます。
- 契約の観測は `/health`（Gatus 自身の未認証ヘルスエンドポイント、200）です。
  `/` は未サインインでも SPA のログイン画面を 200 で返すため、surface は `/` に
  しています。
- state は `/data` の 1 つで、Gatus の SQLite ストレージ（`gatus.db` と WAL）が
  入ります。image は読み取り専用で、書き込みは state と `/tmp` だけです。
- `start.sh` は起動時に Gatus の config を `/tmp` に書き、loopback HTTPS front を
  起動し、discovery が公開 issuer と relay の back-channel を指すことを確認してから
  Gatus を起動します。`/health` が 200、`/api/v1/config` が
  `oidc=true, authenticated=false`、`/oidc/login` が公開 authorize へ 302 することを
  確認して serving になります。どれか欠けると非 0 で終了し、Runner が Run を
  再起動します。
- capsule は 1 step の OCI derivation です。Runner は relay をサービスごとに与える
  ので、Ato は network Binding を宣言した 1 step の route を 1 サービスの group と
  して起動し、そのサービスに `ATO_BINDING_OIDC_ISSUER` を渡します。この動きには
  Coordinator（API）`a250f81c7` 以降と Runner `68de170` 以降が必要です。

## Gatus に適用する設定

| 場所 | キー | 値 |
|---|---|---|
| config.yaml（/tmp、起動ごと生成） | `security.oidc.issuer-url` | 公開 issuer |
| config.yaml | `security.oidc.redirect-url` | `<Instance の公開 origin>/authorization-code/callback` |
| config.yaml | `security.oidc.client-id` / `client-secret` | Binding（`ato.secret@1`） |
| config.yaml | `security.oidc.scopes` | `openid`, `profile`, `email` |
| config.yaml | `security.oidc.allowed-subjects` | 指定しない（全 subject 許可。メンバーは Ato が判定） |
| config.yaml | `storage` | `sqlite`、`path=/data/gatus.db`、`maximum-number-of-results=100`、`maximum-number-of-events=20` |
| config.yaml | `endpoints` | `/health`、`/api/v1/config`（OIDC 有効）、`/api/v1/endpoints/statuses`（未認証は 401）の 3 つ。いずれも 127.0.0.1 宛て |
| 環境変数 | `HTTPS_PROXY` | `http://127.0.0.1:18443`（discovery を HTTPS front へ） |
| 環境変数 | `SSL_CERT_FILE` | ローカル CA + システム CA の bundle（/tmp） |

Gatus の alerting は設定しません。監視対象も Instance 自身（127.0.0.1）だけなので、
この Instance は外部へ通知も通信もしません。

## image を build する

公式 image は `FROM scratch` で、Gatus の静的バイナリと CA bundle だけを持ち、
shell・`/tmp`・interpreter を持ちません。このサンプルは上記の loopback HTTPS front に
bash・openssl・python3 が要るため、`image/Dockerfile` で公式 image（digest 固定）から
バイナリを取り出して Debian "bookworm-slim" に載せ、最後に 1 枚へ平坦化
（`docker export | docker import`）します。Runner は workload を read-only・非 root
（uid 1000）で動かし、`VOLUME` を宣言した image や ENTRYPOINT 付きの image を
受け付けません。

```sh
cd samples/gatus-ato-oidc

# 公式 image の manifest list とプラットフォームごとの digest（2026-10-28 公開）
#   twinproduction/gatus:v5.38.0  index       sha256:085ed63da963728965d00a3c78aa6167e3bf135218485b893201758e079e8415
#                                 linux/amd64 sha256:20f9ae4963ea074521b8da7f438c797d571a58dc51b24abd08d218a6e17b0aca
#                                 linux/arm64 sha256:80e309905cc9a3980c45c62f807ac37c45c0c0df492ff898e8115346f668711c
docker buildx imagetools inspect twinproduction/gatus:v5.38.0

GATUS_IMAGE=twinproduction/gatus:v5.38.0@sha256:80e309905cc9a3980c45c62f807ac37c45c0c0df492ff898e8115346f668711c \
  ./build-images.sh linux/arm64
# → localhost/ato-e2e/gatus-flat@sha256:...（digest-pinned な参照）
```

## capsule.toml を生成する

`capsule.toml` は Instance ごとに変わる値（image 参照、platform、APP_URL、
公開 issuer）を含むので commit せず、`render.sh` で生成します。

```sh
APP_IMAGE=localhost/ato-e2e/gatus-flat@sha256:...   # build-images.sh の出力
./render.sh "$APP_IMAGE" linux/arm64 "https://cinst-....example" \
  https://selfhost.ato.run/v1/selfhost/oidc > capsule.toml
```

`APP_URL` は、その Instance を Ato の Library から開くときの公開
`https://cinst-...` origin です。Gatus はこの値から redirect URL を作るので、
Instance の実際の origin と一致させる必要があります。Instance を作るまで分から
ないため、下の手順では一度 import して origin を確認してから、同じ Instance を
`update-app` で更新します。`PUBLIC_ISSUER` はインストールの公開 issuer です
（既定は `https://selfhost.ato.run/v1/selfhost/oidc`。ローカル E2E は
`https://ato.localhost/v1/selfhost/oidc`）。

## セルフホスト Ato にインストールする

```sh
# 1. secret Binding を用意する（値を capsule やコマンドラインに出さない）
#    {"oidc_client_id":"gatus-ato","oidc_client_secret":"<32+ chars>"}
#    client id は 3-128 文字の [A-Za-z0-9._-] です。

# 2. 仮の origin で import し、Instance の host を確認する
selfhost upload-bundle "$OWNER" < gatus.capsule
selfhost import-bundle "$OWNER" "$BUNDLE" --runner "$RUNNER" \
  --bindings-stdin < gatus.json

# 3. 実際の origin で render し直し、同じ Instance を in-place update する
selfhost update-app "$INSTANCE" "$BUNDLE" --allow-stateful-stop --bindings-stdin < gatus.json

# 4. OIDC client を登録する（secret は stdin）
#    Instance の redirect origin は公開 origin から決まるので、origin を確定してから
selfhost set-app-oidc "$INSTANCE" --client-id gatus-ato \
  --auto email_local --email < client-secret.txt

# 5. organization に共有する
selfhost share-app-with-org "$INSTANCE" "$ORG"
```

## 確認したこと

2026-11-23 にローカルの Lima VM（arm64、linux/arm64、network controls を有効に
した Runner）で確認しました。Coordinator（API）は `a250f81c7`、Runner は
`68de170` 相当、validator は `9cc4eaf1` の版です。

- digest 固定の公式 Gatus image からバイナリを取り出し、`build-images.sh` で
  平坦化した image を read-only・非 root（1000:1000）・1 state・64 MB の noexec
  `/tmp` で起動し、`/health` が 200、`/api/v1/config` が
  `oidc=true, authenticated=false`、`/oidc/login` が公開 authorize へ 302
  することを確認しました（local のスタブ relay でも同じ確認をしています）。
- 単一 step の OCI route に `ATO_BINDING_OIDC_ISSUER` が注入され、Instance は
  `/health` の contract を満たして ready になりました。`set-app-oidc` が返す
  redirect origin は Instance の公開 origin と一致しました
  （`https://cinst-...apps.ato.localhost`）。
- loopback HTTPS front 経由で Gatus が discovery を取得し、id_token の署名と
  `iss` を公開 issuer に対して検証したうえで、Ato の authorize → callback で
  サインインできました。**Gatus のパスワード入力はなく**、未サインインの画面から
  「Login with OIDC」を 1 回押すだけです（`/oidc/login` の 302 連鎖で
  authorize → callback → `/` を確認）。
- 2 人の Ato ユーザー（bob@example.com / carol@example.com）がそれぞれ
  Library から Instance を開き、サインイン後の `/api/v1/endpoints/statuses`
  が 200 で 3 endpoint（health / config / anonymous-statuses-refused）の結果を
  返すこと、`/api/v1/config` が `authenticated=true` を返すことを確認しました。
  Gatus 側にユーザー概念はないため、この 2 人の画面は同一です。
- 2 人が同じ endpoint と同じ結果（latest の success と status、件数）を見ること。
- README だけを変えた rebuild への in-place update が state を checkpoint /
  restore して `completed` になり（`checkpoint_revision_id` は
  `isrev_01M82RNDBEB2K3VWYFA8BY12K2`）、update 後の再サインインでも以前の
  result の timestamp と件数が残っていました（履歴は state に残る）。
- organization から carol を外すと、開いていたセッションの次のリクエストは 403、
  Library からの再オープンは 404 になり、bob のセッションは 200 のままでした。
- この run 終了時の state は `du` で 1.1 MiB、checkpoint が pack する非圧縮 tar で
  1,085,440 bytes でした（update 前は `du` 984 KiB、tar 1,013,760 bytes）。上限 64 MiB
  の内側です。中身は SQLite の `gatus.db` と WAL で、保持件数は Gatus の
  `maximum-number-of-results` / `maximum-number-of-events`、uptime は Gatus 自身の
  hourly/daily 集約で制限しています。
- Runner の slot は、直前に使われていた always_on の Instance の状態を記録して
  `on_demand/stopped` にして空け、確認後に復元しました（Gatus は
  `on_demand/stopped` のまま、記録した always_on の Instance は
  `always_on/running` に戻しました）。

## 制限

- 1 Instance = 1 Gatus です。Gatus にはアカウントの概念がなく、organization の
  メンバーは全員が同じダッシュボードと同じ結果を見ます。個人ごとの画面・権限は
  ありません。
- Gatus は OIDC の自動リダイレクトを持たないため、最初に「Login with OIDC」を
  1 回押します。Ato のサインイン済みセッションがあれば、authorize は追加の入力
  なしで戻ります。
- Gatus の OIDC セッションは in-memory（Gatus の sessions.go）で、Gatus が
  再起動すると全員がサインアウトします（再度「Login with OIDC」を押す）。
  `session-ttl` は既定の 8 時間です。
- Gatus は Basic 認証も持っていますが、このサンプルでは有効にしません。
  Gatus の OIDC はあくまでダッシュボードのゲートで、Ato の gateway（organization
  のメンバーだけを通す）と重ねて使います。
- Runner は read-only の root filesystem・非 root（本番は 1000:1000）・`/tmp` は
  64 MB の noexec tmpfs で動かします。書き込みは state と `/tmp` だけです。
- state checkpoint は control plane と Runner の両方で 64 MiB までです
  （`ato.state.filesystem@1` の非圧縮 tar）。Gatus の保持件数
  （`maximum-number-of-results` / `maximum-number-of-events`）で state を
  小さく保っていますが、監視対象やイベントを増やすときはこの上限を意識して
  ください。
- HTTPS front の証明書と CA は起動ごとに `/tmp` に作り直します（state には
  残しません）。公開 issuer のホスト名は render 時の `PUBLIC_ISSUER` から決まります。