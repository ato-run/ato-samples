# Ato でサインインする BookStack（OpenID Connect）

BookStack v26.09.3 をセルフホストの Ato 上で動かすサンプルです。Ato の
Library から開くと、その人の Ato アカウントでサインインした状態で使え、
BookStack 自身のログインフォームは使いません。利用者ごとに BookStack の
アカウントが作られ、Ato のアカウントマッピングが渡す `name` を表示名に、
`email` をメールアドレスに使います。

## 仕組み

- Ato のセルフホスト Coordinator が OpenID Provider です
  （`<origin>/v1/selfhost/oidc`）。
- `oidc_issuer` Binding（`ato.oidc-issuer@1`）は、BookStack サービスに
  Runner が持つ relay を渡します。token と userinfo はサーバー側で
  `ATO_BINDING_OIDC_ISSUER` 経由、ブラウザは公開 authorize endpoint を
  使います。公開 issuer は capsule の env `ATO_OIDC_PUBLIC_ISSUER`
  （既定は `https://selfhost.ato.run/v1/selfhost/oidc`）で、別の
  インストールではこの 1 行を変えます。
- `oidc_client_id`・`oidc_client_secret`・`db_password` は import 時に
  渡す secret Binding です。
- `start.sh` は毎起動時に `/var/lib/bookstack/.env` を書き直します。
  `APP_KEY` と OIDC の公開鍵だけを state に残し、JWKS は relay から取得して
  BookStack 同梱の phpseclib 3 で PEM に変換して `OIDC_PUBLIC_KEY` として
  渡します。DB が応答するのを待って `php artisan migrate --force` を実行し、
  最後に Apache を起動します。
- `mariadb-start.sh` は初回だけ小さな設定で datadir を初期化し、毎起動時に
  データベースとユーザーのパスワードを再適用します。secret をローテート
  しても再起動で反映されます。
- コードは image の読み取り専用領域にあります。Instance の state は
  `/var/lib/bookstack`（`.env`、`storage/`、`bootstrap/cache/`、
  `public/uploads/`、鍵）と `/var/lib/bookstack-db`（MariaDB のデータ）の
  2 つだけです。

## image を build する

Runner は workload を read-only・非 root で動かし、`VOLUME` を宣言した
image を受け付けません。`build-images.sh` は BookStack の image を build し
（MariaDB は pull し）、`docker export | docker import` で 1 枚に平坦化して
image id を 2 つ出力します。平坦化のとき、元 image の ENV と WORKDIR を
保ったまま USER を 33:33（BookStack）／999:999（MariaDB）にし、ENTRYPOINT
を外します（`VOLUME` は import 後の image には残りません）。

```sh
cd samples/bookstack-ato-oidc
./build-images.sh linux/amd64
# 1 行目: BookStack の image id
# 2 行目: MariaDB の image id
```

image は Runner の CPU に合わせて作ります。`image/Dockerfile` の php と
`build-images.sh` の mariadb の digest は linux/amd64 用です。arm64 の
Runner では同じ tag の arm64 digest に差し替えてから build してください
（`docker buildx imagetools inspect php:8.3-apache` で確認できます）。
composer の digest は multi-arch index なので通常そのままで構いません。

平坦化した image はローカルの `localhost/ato-e2e/bookstack-flat` と
`localhost/ato-e2e/mariadb-flat` に tag されます。`render.sh` は
`sha256:...` と `repo@sha256:...` の両方を受け付けます。Runner が
image id を直接解決できない構成では、同じ image をレジストリに push した
`repo@sha256:...` を render に渡してください。

## capsule.toml を生成する

`capsule.toml` は Instance ごとに変わる値（image id、platform、APP_URL）を
含むので commit せず、`render.sh` で生成します。

```sh
APP_IMAGE=sha256:...   # build-images.sh の 1 行目
DB_IMAGE=sha256:...    # build-images.sh の 2 行目
./render.sh "$APP_IMAGE" "$DB_IMAGE" linux/amd64 "https://cinst-....example" \
  > capsule.toml
```

`APP_URL` は、その Instance を Ato の Library から開くときの公開
`https://cinst-…` origin です。Instance を作るまで分からないため、下の
手順では一度 import して route を確認してから、同じ Instance を
`update-app` で更新します。

## セルフホスト Ato にインストールする

1. client id と 32 文字以上の client secret、DB パスワードを決めます。
2. まず Instance を作ります。この時点の `APP_URL` は仮の origin で構いません。

   ```sh
   ato upload-bundle bookstack-ato-oidc          # → BUNDLE
   ato import-bundle "$OWNER" "$BUNDLE" --runner "$RUNNER" --bindings-stdin
   ```

   `--bindings-stdin` では `oidc_client_id`・`oidc_client_secret`・
   `db_password` の 3 つの secret を渡します。

3. Instance の route（`https://cinst-…`）を確認し、その origin で
   `capsule.toml` を render し直して同じ Instance に反映します。

   ```sh
   ./render.sh "$APP_IMAGE" "$DB_IMAGE" linux/amd64 "https://cinst-....example" \
     > capsule.toml
   ato upload-bundle bookstack-ato-oidc
   ato update-app "$INSTANCE" --bundle "$BUNDLE"
   ```

4. アプリの OIDC を有効にします。client secret は stdin から渡します。

   ```sh
   ato set-app-oidc "$INSTANCE" --client-id "$CLIENT_ID" --auto email_local \
     < client-secret.txt
   ```

5. メンバーを追加するか（`add-app-member`）、organization に共有します。

   ```sh
   ato share-app-with-org "$INSTANCE" --org "$ORG"
   ```

Runner は network controls を有効（`ATO_RUNTIME_NETWORK_CONTROLS=true`）にし、
`network=ato.oidc-issuer@1` を提供している必要があります。

## 制限と未検証項目

- このサンプルはこのリポジトリの検証環境で image の build も実行もして
  いません。確認したのは `sh -n` / `bash -n` と `render.sh` が生成する
  TOML だけです。次の点は実際のデプロイで確認してください。
  - BookStack v26.09.3 が `OIDC_USERINFO_ENDPOINT` と `OIDC_PUBLIC_KEY`
    を解釈すること。`OIDC_USERINFO_ENDPOINT` は
    `BOOKSTACK_OIDC_USERINFO_ENDPOINT=0` で `.env` から外せます。
  - BookStack 同梱の phpseclib 3 で JWKS から PEM に変換できること
    （`start.sh` は 3 通りの API を順に試します）。
  - `/status` が未認証で 200 を返し、contract の観測に使えること。
  - BookStack の archive から `composer install` だけで動くこと。
  - `ato upload-bundle` / `import-bundle` / `update-app` の引数は
    CLI のバージョンに合わせて読み替えてください（このサンプルでは
    デプロイを実行していません）。
- OIDC の公開鍵は起動のたびに取り直します。プロバイダの鍵がローテート
  したらサービスを再起動してください。relay に届かないときは state に
  残っている前回の鍵を使い続けます。
- state checkpoint は 64 MiB までです。MariaDB は
  `innodb_log_file_size=8M`・`innodb_buffer_pool_size=64M`・
  `performance_schema=OFF`・binlog なし・test DB なし・
  `ibdata1:12M:autoextend` で初期化していますが、wiki が育つと in-place
  update には収まらなくなります。その場合は DB を export して新しい
  Instance に移してください。
- `APP_PROXY=*` は Runner が付ける転送ヘッダ（`X-Forwarded-Proto`）を
  信頼するための設定です。BookStack を Runner の外に直接公開しないで
  ください。
- MariaDB は同じ derivation の service として動きます。外部 DB を使う場合は
  service と binding を差し替えてください。
- 1 Instance = 1 BookStack です。水平スケールはしません。
