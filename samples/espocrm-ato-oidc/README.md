# Ato でサインインする EspoCRM（OpenID Connect）

EspoCRM 9.1.5 をセルフホストの Ato 上で動かすサンプルです。Ato の Library
から開くと、その人の Ato アカウントでサインインした状態で使え、EspoCRM 自身の
パスワードログインは使いません。利用者ごとに EspoCRM のアカウントが作られ、
Ato のアカウントマッピングが渡す `preferred_username` をユーザー名に、
`email` をメールアドレスに使います。作られたアカウントには既定のロールと
チームが付き、管理者が手を貸さなくても自分の取引先（Accounts）と連絡先
（Contacts）を作って読めます。

## 仕組み

- Ato のセルフホスト Coordinator が OpenID Provider です
  （`<origin>/v1/selfhost/oidc`）。
- `oidc_issuer` Binding（`ato.oidc-issuer@1`）は、EspoCRM に Runner が持つ
  relay（`ATO_BINDING_OIDC_ISSUER`、コンテナの gateway 上の http）を渡します。
  token・userinfo・JWKS はサーバー側で relay 経由、ブラウザは公開 authorize
  endpoint を使います。公開 issuer は capsule の env
  `ATO_OIDC_PUBLIC_ISSUER`（既定は `https://selfhost.ato.run/v1/selfhost/oidc`）
  で、別のインストールではこの 1 行を変えます。
- id_token の `iss` は公開 issuer なので、EspoCRM の設定も issuer は公開 URL、
  authorize は公開 URL、token・userinfo・JWKS は relay という組み合わせに
  します。EspoCRM が http の back-channel を受け付けない場合だけ、
  `ESPO_OIDC_RELAY_TLS=1` で socat の localhost TLS 終端
  （`https://localhost:8443`）を挟めます。証明書と鍵は起動のたびに `/tmp`
  に作り、state には残しません。外へ出る経路は relay だけのままです。
- `oidc_client_id`・`oidc_client_secret`・`db_password`・
  `admin_password` は import 時に渡す secret Binding です。capsule には
  何も secret を書きません。
- capsule は 1 step の OCI derivation です（`oci_service_group` ではあり
  ません）。Runner は relay をサービスごとに与えるので、Ato は network
  Binding を宣言した 1 step の route を 1 サービスの group として起動します
  （ato-api `1abbe9b` 以降と、ato の Runner `68de170` 以降が必要です）。
- EspoCRM とその MariaDB は **1 つのコンテナ** で動きます。portable な
  capsule は filesystem state を 1 つしか持てず、1 つの state を 2 つの
  サービスで共有することもできません。DB を別サービスにすると state を
  分けることになるため、app image に Debian の `mariadb-server` を入れ、
  state `/var/lib/espocrm` の中に DB の datadir を置いています。
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
  - 初回起動時、EspoCRM 同梱のコンソールインストーラ
    （`php command.php install ...`）で `data/config.php`、DB スキーマ、
    管理者アカウントを非対話で作ります。web installer（`/install`）は
    image の Apache 設定で HTTP から拒否しています。
  - 毎起動、`/var/lib/espocrm/data/config.php` を書き直します。DB の
    パスワードは `db_password` に、`siteUrl` は公開 origin に、OIDC の
    issuer・client id/secret・authorize/token/userinfo/JWKS の各 endpoint・
    scopes は Binding と relay に合わせます。EspoCRM はこのファイルを設定の
    正本として読むため、secret のローテーションと origin の変更は再起動だけで
    反映されます。
  - 初回だけ、管理者の資格情報で EspoCRM の REST API を呼び、ロール
    `Ato User` とチーム `Ato` を作ってロールをチームに割り当てます。
    ロールは Accounts/Contacts の作成と、自分が所有するものの読み書きだけを
    許します。OIDC で作られるアカウントはこのチームに入り、このロールを
    持ちます。OIDC が作るアカウントに管理者フラグは付けません。
  - OIDC の設定反映後、EspoCRM の設定キャッシュ（`data/cache`）だけを
    捨てて次のリクエストで作り直させます。アップロードや config は触りません。
  - Apache をバックグラウンドで起動し、MariaDB・Apache・relay への転送の
    どれかが止まったら残りも止めて非 0 で終了します。Runner は Run を
    再起動するので、DB やサインインの経路なしでリクエストを処理し続ける
    ことはありません。
- コードは image の読み取り専用領域にあります。Instance の state は
  `/var/lib/espocrm` の 1 つだけです（EspoCRM の `data/`、`custom/`、
  `client/custom/` と MariaDB の `db/`）。
- contract の観測は、image に入れた静的な `/status`（200、サインイン不要）
  です。EspoCRM の画面はサインインが必要か Ato へのリダイレクトを始めるため、
  未サインインで安定して 200 を返すアプリ内の経路がありません。

## 管理者のサインイン

インストーラが作る `admin` アカウント（パスワードは `admin_password`
Binding）で、EspoCRM の標準ログインから入ります。OIDC で作られる通常の
アカウントはパスワードを持たないので、この経路を通常ユーザーが使うことは
ありません（Ato を通らない通常ユーザーの抜け道にはなりません）。

初期設定では EspoCRM の認証方法を OIDC にしつつ、管理者のための標準ログイン
を残す設定（`oidcAllowStandardLogin`）を入れています。固定したリリースが
この設定を持たない／標準ログインを無効にする場合は、VM フェーズで管理者の
入り方を確定します（下の「未検証」）。

## image を build する

Runner は workload を read-only・非 root で動かし、`VOLUME` を宣言した
image を受け付けません。EspoCRM は公式の `espocrm/espocrm` image を
digest で固定して使い、その上に Debian の `mariadb-server`・`socat`・
`openssl`・`curl` を入れます。`build-images.sh` は次の 2 段階で
平坦化します。

1. 公式 image を `docker export | docker import` で 1 枚に潰し、
   `data/`・`custom/` の `VOLUME` 宣言を落とします。これがないと、
   実行時の anonymous volume が symlink を隠し、平坦化で state 用の
   ディレクトリが失われます。
2. その image を base に Dockerfile を build し、最後に同じ方法で
   1 枚に潰して image id を 1 つ出力します。ENV は 1 つずつダブルクォートで
   囲んで `--change` に渡し（空白を含む値で `docker import` が
   `Syntax error` にならないように）、WORKDIR を保ったまま USER を 33:33
   にし、ENTRYPOINT を外します。Runner は実行時に自分のユーザーを指定する
   ので、USER は Runner の外で動かすときの既定です。

EspoCRM のバージョンは `build-images.sh` の `espocrm_version` で固定して
います。digest はプラットフォームごとに違うので commit せず、
`ESPO_IMAGE` で必須にしています（tag だけの指定は build が拒否します）。

```sh
cd samples/espocrm-ato-oidc

# Runner の CPU に合う digest を確認する（linux/amd64 の行）
docker buildx imagetools inspect espocrm/espocrm:9.1.5

ESPO_IMAGE=espocrm/espocrm:9.1.5@sha256:... ./build-images.sh linux/amd64
# EspoCRM（+ MariaDB）の image id
```

平坦化した image はローカルの `localhost/ato-e2e/espocrm-flat` に tag
されます。`render.sh` は `sha256:...` と `repo@sha256:...` の両方を受け付け
ます。Runner が image id を直接解決できない構成では、同じ image を
レジストリに push した `repo@sha256:...` を render に渡してください。

## capsule.toml を生成する

`capsule.toml` は Instance ごとに変わる値（image id、platform、APP_URL）を
含むので commit せず、`render.sh` で生成します。

```sh
APP_IMAGE=sha256:...   # build-images.sh の出力
./render.sh "$APP_IMAGE" linux/amd64 "https://cinst-....example" \
  > capsule.toml
```

`APP_URL` は、その Instance を Ato の Library から開くときの公開
`https://cinst-...` origin です。Instance を作るまで分からないため、下の
手順では一度 import して route を確認してから、同じ Instance を
`update-app` で更新します。

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
   ./render.sh "$APP_IMAGE" linux/amd64 "https://cinst-....example" \
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

## 未検証（VM フェーズで確認する）

このサンプルはコードだけを先に作ったもので、image の build・VM 上での起動・
実際のサインインはまだ確認していません。次の点は EspoCRM のソースをこの
フェーズで読めなかったための前提で、VM フェーズで実物に合わせて直します。

1. **固定したリリース**: 9.1.5 が存在し、OIDC 認証を core で持つこと。
   `build-images.sh` の `espocrm_version` と README の記述を実際の
   latest stable に合わせます。プラットフォームごとの digest は初回 build で
   解決した値を上のコマンド例に記録し、以後は同じ digest で build します。
2. **設定の場所と名前**: EspoCRM の設定（管理者設定を含む）が
   `data/config.php` にあり、`authenticationMethod`・`oidcClientId`・
   `oidcClientSecret`・`oidcIssuer`・`oidcAuthorizationEndpoint`・
   `oidcTokenEndpoint`・`oidcUserinfoEndpoint`・`oidcJwksEndpoint`・
   `oidcScopes`・`oidcAutoCreateUser`・`oidcUsernameClaim`・
   `oidcEmailClaim`・`oidcDefaultRole`・`oidcDefaultTeam`・
   `oidcAllowStandardLogin` というキーで読まれること。実際のキー名・値の
   形式（OIDC の method 名、ロール/チームが id か名前か）が違えば
   `image/espocrm-config.php` の 1 か所を直します。
3. **コンソールインストーラ**: `php command.php install` が存在し、
   `--db-host` などのオプション名と管理者作成・`siteUrl` 設定が期待どおり
   であること。web installer だけのリリースなら、初回起動のインストール方法を
   HTTP 経由に変えます。
4. **OIDC の初回サインイン**: `preferred_username` でユーザーを作り、
   `email` をメールアドレスに入れ、既定ロール/チームを付けること。既定
   ロール/チームの設定が無い場合は、EspoCRM の API でアカウント作成後に
   ロール・チームを付ける小さな処理を足します。
5. **ロールの権限**: ロール `Ato User` の ACL（`data` の JSON。create は
   `yes`、read/edit は `own`、delete は `no`）が意図どおりに解釈され、
   Accounts/Contacts を作って自分のものを読めること。チームへのロール割り当て
   の API 経路（`POST /api/v1/Role/{id}/teams`）も確認します。
6. **管理者の入り方**: OIDC を認証方法にしても管理者の標準ログインが残る
   こと。残らない場合は、管理者を Ato 経由で入れる設計（管理者の Ato
   アカウントを先に作り isAdmin を付ける）に切り替えます。
7. **back-channel の http**: EspoCRM が relay の http token/userinfo/JWKS を
   そのまま受け付けること。拒否する場合は `ESPO_OIDC_RELAY_TLS=1` を
   capsule.toml.in の env に入れて socat 経由にします。
8. **siteUrl と redirect_uri**: EspoCRM が `redirect_uri` を `siteUrl`
   から組み立て、Ato の app origin と一致すること。プロキシ配下で
   `X-Forwarded-Proto` を見ないための確認です。
9. **state の大きさ**: EspoCRM の DB と `data/`（cache・upload）が
   checkpoint の 64 MiB に収まること。EspoCRM の DB は BookStack より
   大きいので、初期化直後の `du` と checkpoint の成否を VM で確認します。
10. **image の前提**: 公式 `espocrm/espocrm` image が Debian 系で
    `apt-get` と Apache の `apache2-foreground` を持ち、PHP の設定
    ディレクトリが `${PHP_INI_DIR}/conf.d` であること。install root と
    document root は `/etc/espocrm-root` / `/etc/espocrm-docroot` に
    記録し、start.sh はそれを使います。
11. **PHP の拡張**: image の build 時に pdo_mysql・mbstring・json・
    openssl・zip・gd・curl・xml・dom・fileinfo を確認しています。公式
    image がどれかを欠く場合は build が失敗します。

確認したコマンドは `bash -n`（`build-images.sh`・`start.sh`）、
`sh -n`（`render.sh`）、ダミー値での `render.sh` 出力の
`python3 -c 'import tomllib ...'` です。Mac に `php` がないため
`php -l` は実行できていません。

## 制限

- 1 Instance = 1 EspoCRM です。水平スケールはしません。
- Runner は read-only の root filesystem・非 root（本番は 1000:1000）・
  `/tmp` は 64 MB の noexec tmpfs で動かします。書き込みは state と
  `/tmp` だけです（Apache の run/lock/log、PHP の session と一時 upload、
  MariaDB の socket と一時ファイル、TLS 証明書）。
- MariaDB はコンテナ内の 127.0.0.1 だけを listen し、別ホストの DB は
  使いません。外部 DB にする場合は image と binding ごと差し替えてください。
- state checkpoint は 64 MiB までです。EspoCRM の DB や uploads が育って
  収まらなくなったら、in-place update の代わりに DB を export して新しい
  Instance に移してください。
- OIDC の JWKS は EspoCRM がトークン検証のたびに relay 経由で取得します。
  relay に届かないときの挙動（キャッシュの有無）は VM フェーズで確認します。
- `APP_PROXY` のようなプロキシ信頼設定は EspoCRM 側にありません。
  `siteUrl` を公開 origin に固定し、Runner の外に直接公開しないでください。
- `start.sh` は bash の `wait -n` を使うため、capsule が `/bin/sh` で
  起動した場合は自分自身を `/bin/bash` で再実行します。image の base
  （Debian）には bash が入っています。
- 管理者の標準ログインは「通常ユーザーが Ato を通らない抜け道」にしないため、
  通常アカウントにはパスワードを作りません。管理者パスワードは
  `admin_password` Binding でローテーションできます。
