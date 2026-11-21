# Gitea + Ato identity headers

Gitea 1.27.3 を Ato 上で動かし、Ato のアプリゲートウェイが付ける
`X-Ato-Account` / `X-Ato-Email` ヘッダーだけでサインインさせるサンプル。
Gitea 側は reverse proxy 認証（自動登録あり）で動き、利用者は Gitea の
ログイン画面を経由しない。初回アクセス時に、メールアドレスのローカル部を
アカウント名として Gitea アカウントが作られる（`--auto-account email_local`）。

偽装されたヘッダーはゲートウェイが必ず落とすので、利用者が他人のアカウントに
なることはできない。このサンプルは、セルフホストの Ato で実際に動いている
構成（2026-11-21 検証、下記）を再現したものである。

## 構成

| ファイル | 役割 |
| --- | --- |
| `capsule.toml.in` | レンダリング用テンプレート（`@IMAGE@`, `@PLATFORM@`, `@ARCH@`） |
| `render.sh` | `./render.sh IMAGE_REF PLATFORM > capsule.toml` で manifest を生成 |
| `build-image.sh` | 1 プラットフォーム分の flat イメージを作り、image id を出力 |
| `workspace.txt` | capsule の名前 |

- state は `/var/lib/gitea`（SQLite DB とリポジトリ）を read-write でマウント。
- 契約は `GET /api/healthz` の 200。
- effects は `pure`。メモリ 512 MiB、CPU 1 コア、pids 256。
- Gitea の設定はすべて `GITEA__*` 環境変数で渡す（`app.ini` は書かない）。

## なぜイメージを flatten するか

Runner はイメージの `VOLUME` 宣言を受け付けない。Gitea 公式イメージは
`/var/lib/gitea` などを `VOLUME` に持つため、そのままでは起動できない。
`build-image.sh` は固定 digest の公式イメージからファイルシステムだけを
`docker export | docker import` で取り出し、`USER` / `WORKDIR` / `ENV` /
`EXPOSE` / `ENTRYPOINT` を `--change` で付け直した flat イメージを作る。
state は `/var/lib/gitea` へのマウントで永続化される。

イメージの中身は CPU に依存するので、**ゲストと同じ CPU のマシンでビルドする**
（`linux/amd64` なら amd64、`linux/arm64` なら arm64）。別 CPU 向けの
イメージを読み込んでも起動しない。

## セルフホスト Ato での手順

1. ゲストと同じ CPU のマシンでイメージを作る。標準出力にイメージ ID
   （`sha256:...`）が出る。

   ```sh
   ./build-image.sh linux/arm64        # 例: arm64。amd64 なら linux/amd64
   ```

   イメージをゲストの Docker へ運んで読み込む。

   ```sh
   docker save localhost/ato-samples/gitea-flat:1.27.3-arm64 -o gitea-flat.tar
   # gitea-flat.tar をゲストへ運び、ゲストの Docker で
   docker load -i gitea-flat.tar
   ```

2. manifest をレンダリングする。`IMAGE_REF` は build したタグに image id を
   `@` でつないだもの（デプロイ済みの manifest と同じ `repo@sha256:...` 形式）。

   ```sh
   ./render.sh "localhost/ato-samples/gitea-flat@sha256:..." linux/arm64 > capsule.toml
   ```

3. pack してアップロードする。`BUNDLE` は `upload-bundle` が返す bundle 名。

   ```sh
   ato pack
   ato upload-bundle OWNER
   ato import-bundle OWNER BUNDLE --runner RUNNER_ID
   ```

4. ヘッダーでサインインするよう identity を設定する。

   ```sh
   ato set-app-identity INSTANCE --mode headers \
     --account-header X-Ato-Account --email-header X-Ato-Email \
     --auto-account email_local
   ```

5. 組織に共有する場合（任意）。

   ```sh
   ato share-app-with-org INSTANCE ORG
   ```

6. 更新は checkpoint を取って、データを保持したまま置き換える。

   ```sh
   ato update-app INSTANCE NEW_BUNDLE
   ```

## 検証済み（2026-11-21、セルフホスト本番）

- 2 人が Gitea のログインなしで、それぞれ自分の Gitea アカウントとして開けた。
- その場での更新（`update-app`）後もデータが残っていた。
- 組織から人を外すと、その人の開いているセッションが拒否された。

## 制限

- Gitea の権限（admin、リポジトリのアクセス権）は Gitea の中で管理する。
  Ato のヘッダーが決めるのは「誰としてサインインするか」だけ。
- SSH は無効（`DISABLE_SSH=true`, `START_SSH_SERVER=false`）。clone / push は HTTP のみ。
- 1 つの Runner が同時に動かせるアプリは 1 つ。
