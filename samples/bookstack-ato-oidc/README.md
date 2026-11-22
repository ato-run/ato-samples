# Ato でサインインする BookStack（OpenID Connect）

BookStack v26.09.3 をセルフホストの Ato 上で動かすサンプルです。Ato の
Library から開くと、その人の Ato アカウントでサインインした状態で使え、
BookStack 自身のログインフォームは使いません。利用者ごとに BookStack の
アカウントが作られ、Ato のアカウントマッピングが渡す `name` を表示名に、
`email` をメールアドレスに使います。

## 仕組み

- Ato のセルフホスト Coordinator が OpenID Provider です
  （`<origin>/v1/selfhost/oidc`）。
- `oidc_issuer` Binding（`ato.oidc-issuer@1`）は、BookStack に Runner が
  持つ relay（`ATO_BINDING_OIDC_ISSUER`、コンテナの gateway 上の http）を
  渡します。token と userinfo はサーバー側で relay 経由、ブラウザは公開
  authorize endpoint を使います。公開 issuer は capsule の env
  `ATO_OIDC_PUBLIC_ISSUER`（既定は `https://selfhost.ato.run/v1/selfhost/oidc`）
  で、別のインストールではこの 1 行を変えます。
- BookStack は token と userinfo の endpoint に `https://` しか受け付けません。
  relay が http のときは、`start.sh` が socat でコンテナ内の
  `https://localhost:8443` に TLS を終端して relay へ転送し、その証明書を
  PHP の `curl.cainfo` に加えます（公開 CA もそのまま信頼します）。証明書と
  鍵は起動のたびに `/tmp` に作り、state には残しません。外へ出る経路は
  relay だけのままです。
- `oidc_client_id`・`oidc_client_secret`・`db_password` は import 時に
  渡す secret Binding です。
- capsule は 1 step の OCI derivation です（`oci_service_group` ではあり
  ません）。Runner は relay をサービスごとに与えるので、Ato は network
  Binding を宣言した 1 step の route を 1 サービスの group として起動します
  （ato-api `1abbe9b` 以降と、ato の Runner `68de170` 以降が必要です）。
- BookStack とその MariaDB は **1 つのコンテナ** で動きます。portable な
  capsule は filesystem state を 1 つしか持てず、1 つの state を 2 つの
  サービスで共有することもできません。DB を別サービスにすると state を
  分けることになるため、app image に Debian の `mariadb-server` を入れ、
  state `/var/lib/bookstack` の中に DB の datadir を置いています。
- `start.sh` の流れ:
  - 初回起動時に `mariadb-install-db` で `db/` を初期化します。datadir は
    Runner が指定する非 root のコンテナユーザー（本番の Runner では
    1000:1000）が作り、所有するので root は不要です。
  - 毎起動、`mariadbd` をバックグラウンドで起動して socket
    `/tmp/mysqld.sock` を待ち、`bookstack` データベースと
    `bookstack`@`localhost` ユーザーを冪等に作り、`db_password`
    のパスワードを再適用します。MariaDB は unix socket だけを listen し
    （`skip-networking`）、pid も `/tmp` に置きます。
  - `/var/lib/bookstack/.env` を毎起動書き直します。DB は
    `DB_HOST=localhost` + `DB_SOCKET=/tmp/mysqld.sock`（`DB_PORT` なし）で
    接続します。`APP_KEY` と OIDC の公開鍵だけを state に残し、JWKS は
    relay から取得して BookStack 同梱の phpseclib 3 で PEM に変換して
    `OIDC_PUBLIC_KEY` として渡します。
  - `php artisan migrate --force` のあと、BookStack の `registration-role`
    がまだなければ `BOOKSTACK_DEFAULT_ROLE`（role の表示名、既定は
    `Editor`）にします。BookStack は OIDC で初めて入った人にこの role だけを
    付け、新規インストールでは未設定のため、設定しないと権限のない
    アカウントになります。管理者が後で BookStack で変えた値は上書きしません。
  - Apache をバックグラウンドで起動し、MariaDB・Apache・relay への転送の
    どれかが止まったら残りも止めて非 0 で終了します。Runner は Run を
    再起動するので、DB やサインインの経路なしでリクエストを処理し続ける
    ことはありません。
- コードは image の読み取り専用領域にあります。Instance の state は
  `/var/lib/bookstack` の 1 つだけです（`.env`、`storage/`、
  `bootstrap/cache/`、`public/uploads/`、OIDC の鍵、MariaDB の `db/`）。

## image を build する

Runner は workload を read-only・非 root で動かし、`VOLUME` を宣言した
image を受け付けません。`build-images.sh` は BookStack と MariaDB を入れた
image を 1 つ build し、`docker export | docker import` で 1 枚に平坦化して
image id を 1 つ出力します。平坦化では元 image の ENV を 1 つずつ
ダブルクォートで囲んで `--change` に渡し（`PHPIZE_DEPS` のように空白を
含む値で `docker import` が `Syntax error - can't find = in ...` に
ならないように）、WORKDIR を保ったまま USER を 33:33 にし、ENTRYPOINT を
外します（`VOLUME` は import 後の image には残りません）。Runner は実行時に
自分のユーザーを指定するので、USER は Runner の外で動かすときの既定です。

```sh
cd samples/bookstack-ato-oidc
./build-images.sh linux/amd64
# BookStack（+ MariaDB）の image id
```

`build-images.sh` は `set -euo pipefail` で、build や平坦化の失敗を
成功として扱いません（失敗時は非 0 で終了します）。

image は Runner の CPU に合わせて作ります。`image/Dockerfile` の php の
digest は linux/amd64 用です。arm64 の Runner では同じ tag の arm64
digest に差し替えてから build してください
（`docker buildx imagetools inspect php:8.3-apache` で確認できます）。
composer の digest は multi-arch index なので通常そのままで構いません。

MariaDB は image の base（`php:8.3-apache` = Debian 12 bookworm）が配布する
`mariadb-server` です（10.11 系。正確な patch 版は build 時点の apt が
入れる版で、build log に出る `mariadbd --version` で確認できます）。

平坦化した image はローカルの `localhost/ato-e2e/bookstack-flat` に tag
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

1. client id と 32 文字以上の client secret、DB パスワードを決め、
   `{"oidc_client_id": ..., "oidc_client_secret": ..., "db_password": ...}`
   の JSON を root だけが読めるファイルに置きます（以下 `bookstack.json`）。
2. まず Instance を作ります。この時点の `APP_URL` は仮の origin で構いません。

   ```sh
   selfhost upload-bundle "$OWNER" < bookstack.capsule        # → BUNDLE
   selfhost import-bundle "$OWNER" "$BUNDLE" --runner "$RUNNER" \
     --bindings-stdin < bookstack.json                         # → INSTANCE
   ```

3. Instance の host（`https://cinst-...`）を確認し、その origin で
   `capsule.toml` を render し直し、pack して同じ Instance に反映します。
   `show-app-update` が `completed` になるまで待ちます。

   ```sh
   ./render.sh "$APP_IMAGE" linux/amd64 "https://cinst-....example" \
     > capsule.toml
   selfhost upload-bundle "$OWNER" < bookstack.capsule        # → BUNDLE
   selfhost update-app "$INSTANCE" "$BUNDLE" --bindings-stdin < bookstack.json
   selfhost show-app-update "$INSTANCE"
   ```

4. アプリの OIDC を有効にします。client secret は stdin から渡します。
   BookStack はメールアドレスのない人をサインインさせないので、`--email` で
   id_token に `email` を含めます。

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

## 確認したことと制限

- 2026-11-22 に本番のセルフホスト（linux/amd64、network controls を有効に
  した Runner）で次を確認しました。
  - read-only の image・非 root（1000:1000）・1 state で MariaDB の初期化と
    起動、migration、`/status` の contract 観測（verification receipt が
    `fully_satisfied`）が通ること。
  - 2 人（ブラウザの利用者と、セッションのトークンを使う HTTP クライアント）
    が Library から開くと、BookStack のログインなしにそれぞれ自分の
    BookStack アカウント（`email_local` の名前と Ato のメールアドレス）で
    入れること。新しいアカウントは Editor で、本を作って読めること。
  - 同じ Instance のままの更新（checkpoint を含む）の後も本が残ること。
  - organization から外すと、開いていたセッションの次の要求が 403 になり、
    Library からも開けなくなること。戻すと元のデータが見えること。
- `OIDC_USERINFO_ENDPOINT` は `BOOKSTACK_OIDC_USERINFO_ENDPOINT=0` で
  `.env` から外せます。
- state checkpoint は 64 MiB までです。MariaDB は
  `innodb_log_file_size=8M`・`innodb_buffer_pool_size=64M`・
  `performance_schema=OFF`・binlog なし・test DB なし・
  `ibdata1:12M:autoextend` で初期化しています。初期化直後の state は
  `du` で約 73 MB で、この大きさでも checkpoint は通りました。MariaDB の
  datadir と BookStack の uploads（`public/uploads/`）が育って checkpoint に
  収まらなくなったら、in-place update の代わりに DB を export して新しい
  Instance に移してください。
- BookStack の管理者はいません（パスワードのログインは無効です）。
  role を変えるには、DB で `role_user` を直接変えるか、OIDC の group 同期を
  別に設定してください。
- `start.sh` は bash の `wait -n` を使うため、capsule が `/bin/sh` で
  起動した場合は自分自身を `/bin/bash` で再実行します。image の base
  （Debian）には bash が入っています。
- OIDC の公開鍵は起動のたびに取り直します。プロバイダの鍵がローテート
  したらサービスを再起動してください。relay に届かないときは state に
  残っている前回の鍵を使い続けます。
- `APP_PROXY=*` は Runner が付ける転送ヘッダ（`X-Forwarded-Proto`）を
  信頼するための設定です。BookStack を Runner の外に直接公開しないで
  ください。
- MariaDB は unix socket だけを listen し、TCP の 3306 は開きません。
  別ホストの DB を使う場合は、image と binding ごと差し替えてください。
- 1 Instance = 1 BookStack です。水平スケールはしません。
