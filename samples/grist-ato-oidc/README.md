# Ato でサインインする Grist（OpenID Connect）

Grist 1.7.22（open-source build、公式 `gristlabs/grist-oss` image）を
セルフホストの Ato 上で動かすサンプルです。Ato の Library から開くと、その人の
Ato アカウントでサインインした状態の Grist になり、Grist 自身のログインフォーム
は出ません。Grist のアカウントは初回サインイン時に Grist が作り、表示名には
Ato の app account（`preferred_username`、メールアドレスの local part）、
メールアドレスには Ato の `email` claim を使います。

新しいアカウントは Grist の personal site（`Personal`）と既定のワークスペース
（`Home`）を持ち、Grist の共有機能で自分のメールアドレスにアクセス権が付いた
ドキュメントを開けます。既定のチームサイトはありません（Grist の team site は
利用者が Grist の UI で作るもので、Ato の organization とは別物です）。Ato の
organization への追加・削除は、その Instance を開けるかどうか（Ato の
app gateway が 403 を返すか）を決めます。

このサンプルは Grist 1.7.22 の image 内のソース（`_build` の OIDC 実装と
`openid-client` 5.6.1）を読んで書いています。何を確認済みかは
「確認したこと」にあります。

## 仕組み

- Ato のセルフホスト Coordinator が OpenID Provider です
  （`<origin>/v1/selfhost/oidc`）。
- `oidc_issuer` Binding（`ato.oidc-issuer@1`）は、Grist に Runner が持つ
  relay（`ATO_BINDING_OIDC_ISSUER`、コンテナの gateway 上の http）を渡します。
  Grist は `GRIST_OIDC_IDP_ISSUER` を relay にして discovery を読み、token・
  JWKS・userinfo をサーバー側で relay 経由で取得します。relay は discovery の
  `issuer` と `authorization_endpoint` を公開 https のまま残し、back-channel の
  3 つだけを relay に書き換えるので、ブラウザは公開 authorize endpoint に
  行きます。
- Grist 1.7.22 は `openid-client` 5.6.1 の `Issuer.discover` を使います。
  `Issuer.discover` は設定した URL と discovery の `issuer` の一致を要求しない
  ため、relay を設定値にできます。id_token の `iss` は discovery が返す公開
  issuer として検証されます。
- redirect URI は `GRIST_OIDC_SP_HOST + /oauth2/callback` です。公開 origin
  （Instance の `https://<slug>.apps.ato.localhost`）を設定します。Ato の
  Provider はこの Instance の app origin 以外への redirect を拒否します。
- `GRIST_FORCE_LOGIN=true` により、未サインインのページは Grist のログイン
  フォームではなく、そのまま authorize への 302 になります。ログアウトは
  Provider が `end_session_endpoint` を持たないため
  `GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT=true` で省略し、Grist の
  sign-out は Ato のサインアウトにはなりません。
- Grist は既定で userinfo の `email_verified === true` を要求します。
  `set-app-oidc ... --email` で `email` と `email_verified` が届くようにして
  います。
- Grist は home API とドキュメントを 1 つの Node プロセスで提供します
  （`GRIST_SERVE_SAME_ORIGIN`）。state は `/persist` の 1 つで、
  `home.sqlite3`（ホーム DB・ユーザー・組織）、`docs/`（各ドキュメントの
  SQLite）、`grist-sessions.db` が入ります。コードは image の読み取り専用
  領域にあります。
- `GRIST_IN_SERVICE=true` で Grist の初回セットアップ用 `/boot` ゲートを
  外します（設定は `start.sh` が行うため、人が boot key で作業しません）。
- `start.sh` は起動時に、Binding と公開 origin を検証し、relay の discovery
  が公開 issuer と back-channel の relay を指すことを確認します。Runner の
  relay の bridge address はコンテナ起動直後にまだ応答しないことがあるため、
  この確認は約 90 秒まで再試行します。その後 Node を起動し、`/status` が
  200 になり、未サインインの `/` が公開 `authorize` に 302 することを確認して
  から serving になります。どれか欠けると非 0 で終了し、Runner が Run を
  再起動します。
- capsule は 1 step の OCI derivation です。Runner は relay をサービスごとに
  与えるので、Ato は network Binding を宣言した 1 step の route を 1 サービスの
  group として起動し、そのサービスに `ATO_BINDING_OIDC_ISSUER` を渡します。
  この動きには Coordinator（API）`a250f81c7` 以降と Runner `68de170` 以降が
  必要です（EspoCRM サンプルと同じ）。
- 契約の観測は `/status`（200、サインイン不要）です。Grist の画面は
  サインインのリダイレクトを始めるため、surface も `/status` にしています。

## 実装に合わせた設定

| 環境変数 | 値 | 意味 |
|---|---|---|
| `GRIST_OIDC_IDP_ISSUER` | relay | discovery の取得元。これで OIDC login が有効になる |
| `GRIST_OIDC_SP_HOST` | 公開 origin | redirect URI の base（`/oauth2/callback`） |
| `GRIST_OIDC_IDP_CLIENT_ID` / `_SECRET` | Binding | この Instance の client |
| `GRIST_OIDC_IDP_SCOPES` | `openid profile email` | `email` は `--email` と対 |
| `GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT` | `true` | Provider に end_session が無い |
| `GRIST_FORCE_LOGIN` | `true` | 未サインインのページを authorize へ直行させる |
| `GRIST_IN_SERVICE` | `true` | 初回 `/boot` ゲートを外す |
| `GRIST_SESSION_SECRET` | Binding | セッション cookie の署名 |
| `GRIST_DATA_DIR` / `GRIST_INST_DIR` / `TYPEORM_DATABASE` | `/persist/...` | state の配置 |
| `GRIST_PERSONAL_ORGS` / `GRIST_ORG_CREATION_ANYONE` | `true` | 個人サイトと team site |

## image を build する

Runner は workload を read-only・非 root で動かし、`VOLUME` を宣言した image や
ENTRYPOINT 付きの image を受け付けません。公式 image を digest で固定して使い、
追加の Dockerfile はありません（Python 3.11 と formula sandbox の依存、
`node`/`grist` ユーザーは公式 image に含まれます）。build は image を 1 枚に
平坦化し、ENTRYPOINT を外して `USER 1000:1000` にします。

```sh
cd samples/grist-ato-oidc

# 公式 image の manifest list とプラットフォームごとの digest（2026-10-30 公開）
#   gristlabs/grist-oss:1.7.22  index      sha256:40d2c0ce0c29b2aa1ec1dcf9652ec26a13a8f2b4b44116733bcede428afd27dc
#                               linux/amd64 sha256:48f5642170fb20a83f835b30c3356d7472fe9fe5b2cc94bbfe70b73d83d4ec2d
#                               linux/arm64 sha256:c612d328dd36ee7b3b188d2c3b6af3eaadaeba95640846f1c87dd05746553490
docker buildx imagetools inspect gristlabs/grist-oss:1.7.22

GRIST_IMAGE=gristlabs/grist-oss:1.7.22@sha256:c612d328dd36ee7b3b188d2c3b6af3eaadaeba95640846f1c87dd05746553490 \
  ./build-images.sh linux/arm64
# → localhost/ato-e2e/grist-flat@sha256:...（digest-pinned な参照）
```

## capsule.toml を生成する

`capsule.toml` は Instance ごとに変わる値（image 参照、platform、APP_URL）を
含むので commit せず、`render.sh` で生成します。

```sh
APP_IMAGE=localhost/ato-e2e/grist-flat@sha256:...   # build-images.sh の出力
./render.sh "$APP_IMAGE" linux/arm64 "https://cinst-....example" \
  > capsule.toml
```

`APP_URL` は、その Instance を Ato の Library から開くときの公開
`https://cinst-...` origin です。Grist はこの値から redirect URI を作るので、
Instance の実際の origin と一致させる必要があります。Instance を作るまで
分からないため、下の手順では一度 import して origin を確認してから、同じ
Instance を `update-app` で更新します。

## セルフホスト Ato にインストールする

```sh
# 1. secret Binding を用意する（値を capsule やコマンドラインに出さない）
#    {"oidc_client_id":"grist-ato","oidc_client_secret":"<32+ chars>",
#     "session_secret":"<32+ chars>"}

# 2. 仮の origin で import し、Instance の host を確認する
selfhost upload-bundle "$OWNER" < grist.capsule
selfhost import-bundle "$OWNER" "$BUNDLE" --runner "$RUNNER" \
  --bindings-stdin < grist.json

# 3. 実際の origin で render し直し、同じ Instance を in-place update する
./render.sh "$APP_IMAGE" linux/arm64 "https://cinst-....example" \
  > capsule.toml
selfhost update-app "$INSTANCE" "$BUNDLE" --bindings-stdin < grist.json

# 4. OIDC client を登録する（secret は stdin）
selfhost set-app-oidc "$INSTANCE" --client-id grist-ato \
  --auto email_local --email < client-secret.txt

# 5. organization に共有する
selfhost share-app-with-org "$INSTANCE" "$ORG"
```

## 確認したこと

2026-11-22 にローカルの Lima VM（arm64、linux/arm64、network controls を
有効にした Runner）で確認したこと。Coordinator（API）は `a250f81c7`、Runner は
`68de170`、validator は `9cc4eaf1` の版で行いました。

- digest 固定の公式 image を `build-images.sh` で平坦化し、read-only・非 root
  （1000:1000）・1 state・64 MB の noexec `/tmp` で起動して `/status` が 200、
  未サインインの `/` が公開 authorize に 302 すること（ローカル再現）。
- 単一 step の OCI route に `ATO_BINDING_OIDC_ISSUER` が注入されること。
  Instance は `/status` の contract を満たして ready になり、`set-app-oidc` の
  redirect origin が Instance の公開 origin と一致すること。
- README だけを変えた rebuild への in-place update が state を checkpoint /
  restore して完了すること（`checkpoint_revision_id` が採番されました）。
- 2 人の Ato ユーザーによる end-to-end の確認（Grist のログインフォームなしの
  サインイン、各自の Grist ユーザー、ドキュメントの作成・読み返し、相手の
  ドキュメントが開けないこと、update 後の残存、organization から外した人の
  403）は、cookie を使い回さずに始めた 1 回の run で最後まで通りました
  （2026-11-22、Lima VM）。
- この run 終了時の state は `du` で約 1.6 MiB、checkpoint が pack する
  非圧縮 tar で 1,617,920 bytes でした。上限 64 MiB
  （`MAX_STATE_ARTIFACT_BYTES`）の内側です。

## 制限

- 1 Instance = 1 Grist です。水平スケールはしません。
- Runner は read-only の root filesystem・非 root（本番は 1000:1000）・
  `/tmp` は 64 MB の noexec tmpfs で動かします。書き込みは state と `/tmp`
  だけです。
- state checkpoint は control plane と Runner の両方で 64 MiB までです
  （`ato.state.filesystem@1` の非圧縮 tar）。Grist のホーム DB と空の
  ドキュメントは小さいですが、ドキュメントや添付が育つと超えます。超えたら
  in-place update の代わりにドキュメントを export して新しい Instance に
  移してください。
- Grist の formula sandbox は grist-core 既定の unsandboxed Python（image 内の
  Python 3.11）で動きます。gvisor は使いません。
- ログアウトは Grist のセッションだけを消し、Ato のサインインは残ります。
- Grist の team site と個人サイトの共有は Grist の中だけで完結し、Ato の
  organization とは連動しません。Ato 側の権限は Instance を開けるかどうか
  だけです。
- OIDC の client secret をローテートするときは `set-app-oidc` で更新した
  うえで Instance を再起動してください（`start.sh` は起動時に Binding を
  読み直します）。
