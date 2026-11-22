# Ato でサインインする Paperless-ngx（ヘッダー identity）

Paperless-ngx 3.5.1 をセルフホストの Ato 上で動かすサンプルです。Ato の
Library から開くと、その人の Ato アカウントでサインインした状態で使え、
Paperless 自身のログインフォームは使いません。Ato のアプリゲートウェイが
リクエストに付ける `X-Ato-Account` ヘッダーを Paperless の HTTP remote
user 認証に渡し、Paperless はその値（Ato のアカウントマッピングが渡す
email local part）でアカウントを自動作成します。利用者はそれぞれ自分の
アカウントで文書をアップロードし、自分の文書だけを見ます。

## 仕組み

- Ato のセルフホストは、サインイン済みの人のリクエストに
  `X-Ato-Account: <その人のアプリアカウント>` を付けてアプリへ転送します。
  クライアントが付けた同名ヘッダーは捨てられます。
- Paperless は次の env でヘッダー認証を使います。
  - `PAPERLESS_ENABLE_HTTP_REMOTE_USER=true`
  - `PAPERLESS_ENABLE_HTTP_REMOTE_USER_API=true`
  - `PAPERLESS_HTTP_REMOTE_USER_HEADER_NAME=HTTP_X_ATO_ACCOUNT`
- capsule は 2 つのサービスからなる OCI derivation です。
  - `redis`: state を持たない Redis（Paperless の cache と Celery broker）。
  - `paperless`: filesystem state を 1 つ（`/var/lib/paperless`）持ち、
    Surface Port `app.http` を公開します。
  portable な capsule は filesystem state を 1 つしか持てず、1 つの state を
  2 つのサービスで共有できないため、state は paperless 側だけにあります。
- `start.sh` は 1 つのコンテナで次を順に起動します。
  1. 状態ディレクトリの作成（root filesystem は read-only なので、書けるのは
     state と `/tmp` だけです。`/tmp` は 64 MiB の noexec tmpfs）。
  2. `manage.py migrate --skip-checks --no-input`。
  3. 既定グループの作成（後述）。
  4. granian（ASGI web サーバー、port 8000）、Celery worker、Celery beat を
     バックグラウンドで起動。beat の schedule は state に置きます。
  5. `wait -n` で監視し、どれかが止まったら残りも止めて非 0 で終了します。
     Runner は Run を再起動するので、worker なしで文書を溜め続けることは
     ありません。
- コードは image の読み取り専用領域にあり、workspace は `/app` に
  read-only でマウントされます。Runner は非 root（本番は uid 1000）で実行し、
  `/tmp` 以外の書き込み先は state だけです。

### Django の SECRET_KEY

`secret_key` Binding（`ato.secret@1`、required）が唯一の必須 Binding です。
`start.sh` が `ATO_BINDING_SECRET_KEY` を `PAPERLESS_SECRET_KEY` に写します。
秘密値は capsule.toml には入りません（レンダリング結果にも入りません）。
SECRET_KEY はセッションの署名に使われるので、再起動や in-place update を
またいで同じ値が渡される必要があります。ローテートすると全セッションが
無効になります。

### アカウントと権限（Paperless 3.5.1 の制約とこのサンプルの対処）

Paperless 3.5.1 は `PAPERLESS_ACCOUNT_DEFAULT_GROUPS` を
`paperless.adapter.CustomAccountAdapter.save_user`（allauth のサインアップ/
ソーシャルログイン）でしか読みません。ヘッダー認証のアカウントは Django
標準の `RemoteUserBackend` が作り、その `configure_user` はパスワードを
使えなくするだけでグループを付けません。そのため、何もしないと
ヘッダーから作られたアカウントは権限ゼロになり、文書一覧もアップロードも
403 になります（実機で確認済み）。Paperless には、ヘッダー認証で作られた
アカウントへ既定グループを付ける設定は用意されていません。

このサンプルは Paperless のコードを変更せず、capsule 側の Django settings
（`ato_paperless/settings.py`、`DJANGO_SETTINGS_MODULE` で選択）で
`AUTHENTICATION_BACKENDS` の `RemoteUserBackend` だけを
`ato_paperless.auth.AtoRemoteUserBackend` に差し替え、Paperless 自身の
`PAPERLESS_ACCOUNT_DEFAULT_GROUPS`（=`Ato`）をヘッダー作成アカウントにも
適用します。`start.sh` の `ensure_default_group()` がそのグループを作り、
documents アプリのモデル権限（文書・タグ・ correspondent・文書タイプ・
保存パス・保存ビュー・カスタムフィールド・ノート・共有リンク・タスク）を
付与します。既存の権限を消さないので、管理者が後でグループを編集した内容は
再起動で戻りません。

- アカウントは superuser にも staff にもなりません（最初のユーザーを
  superuser にする処理は allauth adapter の中だけです）。
- 文書の可視性はグループ権限ではなく Paperless の
  `PermittedObjectsFilter` が決めます。全ユーザーは自分が owner の文書と、
  明示的に共有された文書だけを一覧・取得できます。グループ権限は
  「操作できる」ことを表すだけで、他人の文書を見せるものではありません
  （2 ユーザーで相互不可視を実機確認済み）。

ヘッダー認証に既定グループを付ける Paperless 標準の設定が将来追加されたら、
`ato_paperless/` は不要になります。それまでは、この設定の差し替えが
「Paperless のコードを変更しない」最小の方法です。

## image を build する

Runner は workload を read-only・非 root で動かし、`VOLUME` を宣言した
image を受け付けません。`build-images.sh` は upstream の
`ghcr.io/paperless-ngx/paperless-ngx:3.5.1` と
`redis:7.4.12-alpine` を、tag と per-platform digest の両方で固定して
pull し、`docker export | docker import` で 1 枚ずつに平坦化します
（元 image の ENV を 1 つずつダブルクォートし、WORKDIR を保ち、
USER 1000:1000、ENTRYPOINT なし、VOLUME なし）。stdout に image id を
2 行（Paperless-ngx、Redis の順）で出力します。

```sh
cd samples/paperless-ato-headers
./build-images.sh linux/amd64
# 1 行目: Paperless-ngx の image id
# 2 行目: Redis の image id
```

固定している digest は次のとおりです（multi-arch tag の platform 別
manifest digest）。

- paperless-ngx 3.5.1: amd64 `sha256:f477d12a…`、arm64 `sha256:9738d423…`
- redis 7.4.12-alpine: amd64 `sha256:e4ee3e03…`、arm64 `sha256:52d1ea8a…`

未対応の CPU では、上の tag の digest を足すまで失敗します。平坦化した
image は `localhost/ato-e2e/paperless-flat:<tag>-<arch>` と
`localhost/ato-e2e/redis-flat:<tag>-<arch>` に tag されます。

## capsule.toml を生成する

`capsule.toml` は Instance ごとに変わる値（image id と platform）を含むので
commit せず、`render.sh` で生成します。

```sh
APP_IMAGE=sha256:...     # build-images.sh の 1 行目
REDIS_IMAGE=sha256:...   # build-images.sh の 2 行目
./render.sh "$APP_IMAGE" "$REDIS_IMAGE" linux/amd64 > capsule.toml
```

`APP_IMAGE` と `REDIS_IMAGE` は `sha256:...` か `repo@sha256:...` を受け付け
ます。Runner が image id を直接解決できない構成では、同じ image を
レジストリに push した `repo@sha256:...` を渡してください。

## セルフホスト Ato にインストールする

コマンドはセルフホストのホスト CLI（API コンテナの
`node dist/selfhost/server.mjs`、以下 `selfhost`）です。`.capsule` は
`ato pack` で作ります。

1. SECRET_KEY を決め、`{"secret_key": "<50 文字以上のランダム値>"}` の JSON
   を root だけが読めるファイルに置きます（以下 `paperless.json`）。
   `openssl rand -hex 32` などで生成し、capsule やリポジトリには置きません。
2. Instance を作ります。

   ```sh
   selfhost upload-bundle "$OWNER" < paperless.capsule   # → BUNDLE
   selfhost import-bundle "$OWNER" "$BUNDLE" --runner "$RUNNER" \
     --bindings-stdin < paperless.json                    # → INSTANCE
   ```

3. アプリの identity をヘッダー方式にし、organization に共有します。

   ```sh
   selfhost set-app-identity "$INSTANCE" --mode headers --auto-account email_local
   selfhost share-app-with-org "$INSTANCE" "$ORG"
   ```

   `--auto-account email_local` で、Ato のアカウントは email の local part
   になります。Paperless 側の username もこの値です。

4. 同じ Instance を更新するときは、新しい bundle を upload して
   `update-app` します。state を持つサービスの停止を伴うため
   `--allow-stateful-stop` が必要です。binding は
   `--bindings-stdin` で同じ JSON を渡します。

   ```sh
   selfhost upload-bundle "$OWNER" < paperless.capsule   # → BUNDLE2
   selfhost update-app "$INSTANCE" "$BUNDLE2" --derivation sha256:... \
     --bindings-stdin --allow-stateful-stop < paperless.json
   selfhost show-app-update "$INSTANCE"
   ```

## 確認したことと制限

2026-11-22 に arm64 のセルフホスト（Lima VM の 6 GiB、1 Run per Runner）で、
上の image を build し、bundle を import して次を確認しました。

- 2 人（alice / bob）が Library から開くと、Paperless のログインなしに
  それぞれ別のアカウントで入れること。
- それぞれが小さなテキスト文書をアップロードし、Celery worker が処理して
  自分の文書一覧に出ること。互いの文書は見えないこと。
- 自分のセッションで `X-Ato-Account: admin` を追加送信しても、ゲートウェイが
  その値を捨て、サインイン済みの本人として扱われること。
- 同じ Instance を README だけ変更した bundle に in-place update しても、
  2 人の文書が残ること。
- organization から 1 人を外すと、開いていたセッションの次のリクエストが
  403 になること。

制限:

- state checkpoint は 64 MiB までです。Paperless の SQLite データベース
  （検索インデックスを含む）と media（原稿 PDF とサムネイル）が育つと
  超えます。テキスト中心の小さな文書で数十件が目安で、それを超えるなら
  checkpoint ではなく document exporter でデータを出して新しい Instance に
  移してください。
- `/tmp` は 64 MiB の noexec tmpfs です。大きな文書の処理途中で
  スクラッチが溢れる場合は、Runner の tmpfs サイズを上げる必要があります。
- このサンプルは 1 Instance = 1 Paperless です。水平スケールしません。
- 画像のテストは arm64 のみです。amd64 の digest は同じ tag の manifest から
  固定していますが、amd64 の Runner での build・import・E2E は未検証です。
- OCR 言語データ（NLTK/Tesseract の追加言語）は入れていません。
  `PAPERLESS_ENABLE_NLTK=false` です。
- ヘッダー認証用の既定グループ適用は、Paperless の標準設定ではなく
  この capsule の settings 差し替えです（上記「アカウントと権限」）。
  Paperless を upgrade するときは
  `paperless.adapter.CustomAccountAdapter.save_user` と
  `AUTHENTICATION_BACKENDS` の並びを確認し、
  `ato_paperless/settings.py` の差し替えがまだ必要かを見直してください。
- Paperless の管理者はいません（パスワードログインは使いません）。グループや
  権限を変えるには DB を直接変更するか、別途 admin を用意してください。
