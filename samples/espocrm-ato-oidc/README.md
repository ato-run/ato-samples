# Ato でサインインする EspoCRM（OpenID Connect）

EspoCRM 9.3.11 をセルフホストの Ato 上で動かすサンプルです。Ato の Library
から開くと、その人の Ato アカウントでサインインした状態で使え、EspoCRM 自身の
パスワードログインは通常ユーザーには使わせません。利用者ごとに EspoCRM の
アカウントが作られ、Ato のアカウントマッピングが渡す `preferred_username` を
ユーザー名に、`email` をメールアドレスに使います。作られたアカウントには
既定のチームとロールが付き、管理者が手を貸さなくても自分の取引先（Accounts）
と連絡先（Contacts）を作って読めます。

このサンプルは EspoCRM の実物のソース（公式 `espocrm/espocrm` image 9.3.11）
を読んで書いたもので、使う設定キー・インストーラ・API はそのリリースの
実装に合わせています。何を確認済みかは「確認したこと」にあります。

## 仕組み

- Ato のセルフホスト Coordinator が OpenID Provider です
  （`<origin>/v1/selfhost/oidc`）。
- `oidc_issuer` Binding（`ato.oidc-issuer@1`）は、EspoCRM に Runner が持つ
  relay（`ATO_BINDING_OIDC_ISSUER`、コンテナの gateway 上の http）を渡します。
  EspoCRM は token・userinfo・JWKS をサーバー側で relay 経由で取得し、
  ブラウザは公開 authorize endpoint を使います。公開 issuer は capsule の env
  `ATO_OIDC_PUBLIC_ISSUER`（既定は
  `https://selfhost.ato.run/v1/selfhost/oidc`）で、別のインストールではこの
  1 行を変えます。
- EspoCRM 9.3.11 の OIDC クライアントは token・userinfo・JWKS の取得に
  curl を使い、`CURLOPT_PROTOCOLS` に `CURLPROTO_HTTPS | CURLPROTO_HTTP` を
  指定しています（`application/Espo/Core/Authentication/Oidc/Login.php`・
  `UserInfoDataProvider.php`・`KeysProvider.php`）。relay の http をそのまま
  受け付けるため、BookStack サンプルのような localhost TLS 終端は不要です
  （socat も証明書も使いません）。
- 画面のサインインは次の順で進みます。ログインページの JavaScript が
  `GET /api/v1/Oidc/authorizationData` で authorize endpoint・client id・
  redirect URI・scopes を取得し、ポップアップで authorize を開きます。
  redirect URI は `siteUrl + /oauth-callback.php` です（`Oidc/ConfigDataProvider.php`
  の `getRedirectUri()`）。EspoCRM は戻ってきた code を
  `Authorization: Basic base64("**oidc:" + code)` と
  `X-Oidc-Authorization-Nonce` ヘッダでログイン API に渡します。つまり
  authorize 以外は Ato の公開 issuer ではなく relay 側の endpoint で足ります。
- `oidc_client_id`・`oidc_client_secret`・`db_password`・
  `admin_password` は import 時に渡す secret Binding です。capsule には
  何も secret を書きません。
- capsule は 2 サービスの OCI service group です。Runner が
  `ato.oidc-issuer@1` の relay を与えるのは service group のサービスに対して
  だけで、1 step の route には relay が注入されません（VM フェーズで
  `ATO_BINDING_OIDC_ISSUER` が無いことを実測しました）。service group は
  2〜4 サービス必要なので、EspoCRM のコンテナ（`espocrm`）と、同じ image で
  PHP の built-in server を 9999 番で動かすだけの `keepalive` を並べています。
  `keepalive` は Binding も state も持たず、EspoCRM からは何も接続しません。
  Runner は service group の全サービスが Port を受け付けるまで起動完了と
  みなすため、この待ち受けだけが目的です。
- EspoCRM とその MariaDB は **1 つのコンテナ** で動きます。portable な
  capsule は filesystem state を 1 つしか持てず、1 つの state を 2 つの
  サービスで共有することもできません。DB を別サービスにすると state を
  分けることになるため、app image に Debian の `mariadb-server` を入れ、
  state `/var/lib/espocrm` の中に DB の datadir を置いています。
- 公式 image は application を `/usr/src/espocrm` に持ち、起動時に
  `/var/www/html` へコピーして web installer を実行します。Runner の
  filesystem は read-only で、ENTRYPOINT も使わないため、この image は
  `/usr/src/espocrm` をそのまま document root にして `start.sh` が
  インストールと設定を行います。書き込みが要る `data/`・`custom/`・
  `client/custom/`・`install/config.php` は image の build 時に
  state への symlink にしています。
- `start.sh` の流れ:
  - 初回起動時に `mariadb-install-db` で `db/` を初期化します。datadir は
    Runner が指定する非 root のコンテナユーザー（本番の Runner では
    1000:1000）が作り、所有するので root は不要です。
  - 毎起動、`mariadbd` をバックグラウンドで起動して socket
    `/tmp/mysqld.sock` を待ち、`espocrm` データベースと
    `espocrm`@`127.0.0.1`・`localhost` ユーザーを冪等に作り、
    `db_password` のパスワードを再適用します。MariaDB は 127.0.0.1 だけを
    listen し（コンテナの外からは届きません）、pid と socket は `/tmp`
    に置きます。
  - 初回起動時、EspoCRM 9.3.11 のコンソールインストーラで
    `data/config.php`、DB スキーマ、管理者アカウントを非対話で作ります。
    9.3.11 に `php command.php install` は無いので、公式 image の
    entrypoint と同じ `php install/cli.php -a <action> -d <query>` の手順
    （`step1` → `settingsTest` → `setupConfirmation` → `checkPermission` →
    `saveSettings` → `buildDatabase` → `createUser` → `finish`）を実行
    します。web installer（`/install`）は image の Apache 設定で HTTP から
    拒否しています。
  - 初回のインストール直後に、EspoCRM が使わない MariaDB の help テーブルと
    統計を削除し、datadir を小さくします。
  - 毎起動、`/var/lib/espocrm/data/config.php` を書き直します。DB の
    パスワードは `db_password` に、`siteUrl` は公開 origin に、OIDC の
    endpoint・client id/secret・scopes・既定チームは Binding と relay に
    合わせます。EspoCRM はこのファイルを設定の正本として読むため、secret の
    ローテーションと origin の変更は再起動だけで反映されます。
  - 初回だけ、管理者の資格情報で EspoCRM の REST API を呼び、ロール
    `Ato User` とチーム `Ato` を作り、ロールをチームに割り当てます
    （`Team.roles` は linkMultiple なので、チーム作成時に `rolesIds` で
    渡します。`POST /Role/{id}/teams` のような endpoint はありません）。
    ロールは Accounts/Contacts の作成と、自分が所有するものの読み書きだけを
    許し、assignment・user・export・mass update などの権限はすべて `no`
    です。OIDC で作られるアカウントは `oidcTeamsIds` でこのチームに入り、
    このロールを持ちます。OIDC が作るアカウントに管理者フラグは付きません。
  - 契約の観測は image に入れた `/status.php`（200、サインイン不要）です。
    このファイルは state の `ready` マーカーができるまで 503 を返すので、
    インストールや OIDC の設定が終わる前に Instance が healthy 扱いになる
    ことはありません。EspoCRM の画面はサインインが必要か Ato への
    リダイレクトを始めるため、未サインインで安定して 200 を返すアプリ内の
    経路がありません。
  - OIDC の設定反映後、EspoCRM の設定キャッシュ（`data/cache`）だけを
    捨てて次のリクエストで作り直させます。アップロードや config は触りません。
  - Apache をバックグラウンドで起動し、MariaDB か Apache が止まったら
    残りも止めて非 0 で終了します。Runner は Run を再起動するので、DB や
    サインインの経路なしでリクエストを処理し続けることはありません。
- コードは image の読み取り専用領域にあります。Instance の state は
  `/var/lib/espocrm` の 1 つだけです（EspoCRM の `data/`、`custom/`、
  `client/custom/` と MariaDB の `db/`）。

## 実装に合わせた設定キー

EspoCRM 9.3.11 の OIDC 設定は
`application/Espo/Core/Authentication/Oidc/ConfigDataProvider.php` が読みます。
このサンプルが `data/config.php` に書くのは次のキーです。

| キー | 値 | 意味 |
|---|---|---|
| `authenticationMethod` | `Oidc` | 認証方法（`OIDC` ではない） |
| `oidcClientId` / `oidcClientSecret` | Binding | この Instance の client |
| `oidcAuthorizationEndpoint` | 公開 issuer + `/authorize` | ブラウザが開く |
| `oidcTokenEndpoint` | relay + `/token` | サーバー側 |
| `oidcUserInfoEndpoint` | relay + `/userinfo` | サーバー側（`UserInfo` の I は大文字） |
| `oidcJwksEndpoint` | relay + `/jwks` | サーバー側 |
| `oidcJwtSignatureAlgorithmList` | `["RS256"]` | Ato の署名方式 |
| `oidcScopes` | `["profile", "email"]` | `openid` は EspoCRM が足す |
| `oidcUsernameClaim` | `preferred_username` | Ato の app account |
| `oidcCreateUser` | `true` | 初回サインインで作成 |
| `oidcTeamsIds` | `[チーム id]` | 既定チーム（ロールはチーム経由） |
| `oidcSync` / `oidcSyncTeams` | `false` | 既存ユーザーを上書きしない |
| `oidcFallback` | `true` | ログイン画面の「Log in」と API の Basic 認証を残す |
| `oidcAllowRegularUserFallback` | `false` | 通常ユーザーはパスワード経路を使えない |
| `oidcAllowAdminUser` | `false` | OIDC で管理者にはならない |
| `oidcAuthorizationPrompt` | `consent` | ログイン画面が送る値（Ato は none 以外を通常扱い） |

phase 1 が仮に置いていた `oidcIssuer`・`oidcEmailClaim`・
`oidcAutoCreateUser`・`oidcDefaultRole`・`oidcDefaultTeam`・
`oidcAllowStandardLogin` は 9.3.11 には存在しません。メールアドレスは
`email` claim を直接読み、既定ロールはチームに付けたロールで表現し、
管理者の標準ログインは `oidcFallback` で残します。

## 管理者のサインイン

インストーラが作る `admin` アカウント（パスワードは `admin_password`
Binding）で入ります。方法は 2 つです。

- ログイン画面の OIDC ボタンの下に出る「Log in」リンク（`oidcFallback` が
  `true` のときだけ表示されます）から、ユーザー名 `admin` と
  `admin_password` で入る。
- `curl -u admin:<admin_password> https://<app origin>/api/v1/App/user` の
  ように Basic 認証で API のトークンを取る。

通常ユーザーはパスワードを持たず（OIDC が作るときにランダムな
パスワードハッシュが入ります）、`oidcAllowRegularUserFallback` が `false`
なので、この経路は Ato を通らない抜け道にはなりません。

## image を build する

Runner は workload を read-only・非 root で動かし、`VOLUME` を宣言した
image を受け付けません。EspoCRM は公式の `espocrm/espocrm` image を
digest で固定して使い、その上に Debian の `mariadb-server` と `curl` を
入れます。build は次のようになります。

```sh
cd samples/espocrm-ato-oidc

# 公式 image の manifest list とプラットフォームごとの digest（2026-10-23 公開）
#   espocrm/espocrm:9.3.11  index      sha256:c66a18906d54a52e5cda40a3b6b36ac8c8c574deba7b29530c2c6b22227c4d86
#                           linux/amd64 sha256:7f355480b8be27cc76dfb3eec769bc9f7c3ec968e55208473e8451473e2c54d2
#                           linux/arm64 sha256:62d569cb48265575cb79521094fe3f36fda898e8bade7d4b303504e7b5eceb72
docker buildx imagetools inspect espocrm/espocrm:9.3.11

# プラットフォームの digest を渡す。build-images.sh は 9.3.11 のこの 2 つの
# digest 以外を拒否します。
ESPO_IMAGE=espocrm/espocrm:9.3.11@sha256:62d569cb48265575cb79521094fe3f36fda898e8bade7d4b303504e7b5eceb72 \
  ./build-images.sh linux/arm64
# → localhost/ato-e2e/espocrm-flat@sha256:...（digest-pinned な参照）
```

build は image を 1 枚に平坦化し（`docker export | docker import`）、
ENV を保ったまま ENTRYPOINT を外し、USER を 33:33 にします。出力は
`capsule.toml` が要求する digest-pinned 形式です（bare の image id は
validator が拒否します）。

## capsule.toml を生成する

`capsule.toml` は Instance ごとに変わる値（image 参照、platform、APP_URL）を
含むので commit せず、`render.sh` で生成します。

```sh
APP_IMAGE=localhost/ato-e2e/espocrm-flat@sha256:...   # build-images.sh の出力
./render.sh "$APP_IMAGE" linux/arm64 "https://cinst-....example" \
  > capsule.toml
```

`APP_URL` は、その Instance を Ato の Library から開くときの公開
`https://cinst-...` origin です。EspoCRM はこの値から redirect URI
（`/oauth-callback.php`）を作るので、Instance の実際の origin と一致させる
必要があります。Instance を作るまで分からないため、下の手順では一度 import
して origin を確認してから、同じ Instance を `update-app` で更新します。

## セルフホスト Ato にインストールする

コマンドはセルフホストのホスト CLI（API コンテナの
`node dist/selfhost/server.mjs`、以下 `selfhost`）です。`.capsule` は
`ato pack` で作ります。

1. client id と 32 文字以上の client secret、DB パスワード、管理者パスワード
   を決め、次の JSON を root だけが読めるファイルに置きます（以下
   `espocrm.json`）。

   ```json
   {
     "oidc_client_id": "...",
     "oidc_client_secret": "...",
     "db_password": "...",
     "admin_password": "..."
   }
   ```

   `oidc_issuer` は `ato.oidc-issuer@1` Binding なので、import 時に値を
   渡す必要はありません（Runner が relay を渡します）。

2. まず Instance を作ります。この時点の `APP_URL` は仮の origin で構いません。

   ```sh
   selfhost upload-bundle "$OWNER" < espocrm.capsule        # → BUNDLE
   selfhost import-bundle "$OWNER" "$BUNDLE" --runner "$RUNNER" \
     --bindings-stdin < espocrm.json                         # → INSTANCE
   ```

3. Instance の host（`https://cinst-...`）を確認し、その origin で
   `capsule.toml` を render し直し、pack して同じ Instance に反映します。
   `show-app-update` が `completed` になるまで待ちます。

   ```sh
   ./render.sh "$APP_IMAGE" linux/arm64 "https://cinst-....example" \
     > capsule.toml
   selfhost upload-bundle "$OWNER" < espocrm.capsule        # → BUNDLE
   selfhost update-app "$INSTANCE" "$BUNDLE" --bindings-stdin < espocrm.json
   selfhost show-app-update "$INSTANCE"
   ```

4. アプリの OIDC を有効にします。client secret は stdin から渡します。
   `--auto email_local` は `preferred_username` をメールアドレスの local
   part にし、`--email` で id_token に `email` を含めます。EspoCRM はこの
   2 つをユーザー名とメールアドレスに使います。

   ```sh
   selfhost set-app-oidc "$INSTANCE" --client-id "$CLIENT_ID" \
     --auto email_local --email < client-secret.txt
   ```

5. メンバーを追加するか（`add-app-member`）、organization に共有します。

   ```sh
   selfhost share-app-with-org "$INSTANCE" "$ORG"
   ```

Runner は network controls を有効（`ATO_RUNTIME_NETWORK_CONTROLS=true`）にし、
`network=ato.oidc-issuer@1` を提供している必要があります。

## 確認したこと

EspoCRM の実物のソースを読んで確認したこと（9.3.11 の image 内）:

- 公式 image の `ESPOCRM_VERSION` は 9.3.11 で、OIDC は core にあります
  （`Core/Authentication/Oidc`、`Tools/Oidc/Service.php`）。設定キーと
  挙動は「実装に合わせた設定キー」の表のとおりです。
- 非対話インストールは `install/cli.php -a <action> -d <query>` の手順で、
  `php command.php install` は存在しません。
- Role は `Team.roles`（linkMultiple）でチームに付き、`POST /Role/{id}/teams`
  という endpoint はありません。OIDC が作るユーザーは type `regular` で、
  既定チームは `oidcTeamsIds`、既定ロールはそのチームのロールです。
- redirect URI は `siteUrl + /oauth-callback.php` で、ログインは
  `**oidc:<code>` の Basic 認証と `X-Oidc-Authorization-Nonce` です。
- token・userinfo・JWKS の curl は `CURLPROTO_HTTP` を許可しており、relay の
  http をそのまま使えることをソースで確認しました（TLS 終端は不要）。
- OIDC の relay は service group のサービスにだけ注入されます。1 step の
  route では `ATO_BINDING_OIDC_ISSUER` が渡らないことを VM で実測したため、
  このサンプルは `espocrm` と `keepalive` の 2 サービスの group にしています。

2026-11-22 にローカルの Lima VM（arm64、linux/arm64、network controls を
有効にした Runner）で確認したこと:

- 公式 image を上の digest で取得し、`build-images.sh` が digest-pinned な
  image 参照を出力すること。build した image を read-only・非 root
  （1000:1000）・1 state・64 MB の noexec `/tmp` で起動し、MariaDB の初期化、
  `install/cli.php` によるインストール、Apache の起動、Role/Team の作成、
  `/status.php` の 200、OIDC 設定の書き込みまでが通ること（ローカル再現）。
- VM の Runner で service group が起動し、`espocrm` サービスに
  `ATO_BINDING_OIDC_ISSUER` を含む Binding が注入されること。Instance は
  `/status.php` の contract を満たして running になり、`set-app-oidc` で
  登録した client（`--auto email_local --email`）の redirect origin が Instance
  の公開 origin と一致すること。
- state は MariaDB・EspoCRM の `data/` を含めて `du` で約 111 MiB でした
  （MariaDB の help テーブル削除・`innodb_undo_tablespaces=0` などの圧縮を
  入れた後）。この state で in-place update の checkpoint は完了しています
  （下記の未確認事項も参照）。

VM フェーズで確認しきれなかったこと（時間切れで、最終 bundle の再配備中に
作業を止めました）:

- Ato のブラウザサインインから EspoCRM のユーザー作成・Account の作成/読み
  取りまでを通しでの確認。手元の HTTP ドライバでは、Instance がまだ
  `ATO_OIDC_PUBLIC_ISSUER` の既定値（`https://selfhost.ato.run/...`）で
  render された bundle のままで、Ato（`https://ato.localhost`）の authorize が
  400 を返すところまでを観測しました。`render.sh` は 4 番目の引数で
  installation の公開 issuer を渡せるようにし、VM では
  `https://ato.localhost/v1/selfhost/oidc` を渡す手順にしています。この
  修正版 bundle の再配備を実行したところで時間切れになりました。
- 2 人の分離、in-place update 後のレコード保持、organization からの削除後の
  403 は、上記のサインインが通ってからでないと確認できません（未確認）。
- VM の Runner は service group の各サービスが Port を受け付けるまでを
  起動完了とみなすため、`keepalive` は PHP の built-in server で 9999 番を
  待ち受けています。Runner の readiness timeout は 60 秒で、インストールを
  含む初回起動がこれに収まることは確認済みです。

## 制限

- 1 Instance = 1 EspoCRM です。水平スケールはしません。
- Runner は read-only の root filesystem・非 root（本番は 1000:1000）・
  `/tmp` は 64 MB の noexec tmpfs で動かします。書き込みは state と
  `/tmp` だけです（Apache の run/lock/log、PHP の session と一時 upload、
  MariaDB の socket と一時ファイル）。
- MariaDB はコンテナ内の 127.0.0.1 だけを listen し、別ホストの DB は
  使いません。外部 DB にする場合は image と binding ごと差し替えてください。
- state checkpoint は 64 MiB までです。EspoCRM の DB と `data/` は
  インストール直後で約 60 MiB です（MariaDB の help テーブル削除・
  `innodb_undo_tablespaces=0`・小さい redo/temp file で縮めています）。
  レコードや uploads が育って収まらなくなったら、in-place update の代わりに
  DB を export して新しい Instance に移してください。
- EspoCRM の OIDC は id_token の `iss` を設定値と照合しません（存在だけを
  確認します）。issuer の検証は Ato 側の authorize/token が担います。
- OIDC の JWKS は EspoCRM が 10 分キャッシュします（`oidcJwksCachePeriod`）。
  プロバイダの鍵がローテートしたときはサービスを再起動してください。
- `APP_PROXY` のようなプロキシ信頼設定は EspoCRM 側にありません。
  `siteUrl` を公開 origin に固定し、Runner の外に直接公開しないでください。
- `start.sh` は bash の `wait -n` を使うため、capsule が `/bin/sh` で
  起動した場合は自分自身を `/bin/bash` で再実行します。image の base
  （Debian）には bash が入っています。
- 管理者の標準ログインは「通常ユーザーが Ato を通らない抜け道」にしないため、
  通常アカウントにはパスワードを作りません。管理者パスワードは
  `admin_password` Binding でローテーションできます。
- OIDC の client secret をローテートするときは、`set-app-oidc` で更新した
  うえで Instance を再起動してください（`data/config.php` は起動時に
  書き直されます）。