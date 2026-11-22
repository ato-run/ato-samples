# Ato 上で 1 人 1 Instance の TriliumNext（自分だけのノート）

TriliumNext v0.107.0（AGPL-3.0、公式 `triliumnext/trilium` image）をセルフホストの
Ato 上で動かすサンプルです。Trilium は単一ユーザー向けのノートアプリなので、このサンプルは
**1 Instance = 1 人** のモデルを取ります。ある人のノートはその人の Instance にだけ
入り、その Instance を開けるのはその人だけです。

このサンプルは「インストールした人の権限が、他の人のデータを読む権限に広がらない」
ことを前提にしています。セルフホストのホスト CLI は Instance をその人を owner として
import しますが、その Instance を organization に共有しません。したがって、ホスト
CLI を実行するインストール owner（管理者）も、他人の Trilium を開くことはできません。

## なぜ 1 Instance = 1 人なのか

- TriliumNext v0.107 は単一ユーザーのアプリケーションです。マルチユーザーのアカウント
  管理はなく、「共有」は read-only の share 機能だけです。
- ノートの単位は Instance です。1 人増やすと 1 Instance 増え、その人の分だけ state
  も増えます。逆に言えば、Instance の持ち主だけがそのノートを読める、という境界が
  Ato の権限モデル（Instance を開けるかどうか）だけで説明できます。
- そのため、このサンプルは organization への共有をしません。`import-bundle` の
  owner をその人にし、メンバーを追加しないことが、そのまま「本人だけが読める」の
  実装になります。

## サインイン: Trilium のログインを切る（noAuthentication）

v0.107 のソースを読んで、次の 2 つから選びました。

1. **(a) Trilium のログインを切る（`noAuthentication=true`）**。Instance を開ける
   のは Ato のアプリゲートウェイだけです。
2. **(b) Trilium の OpenID Connect を、その Instance の owner 1 人にだけ束ねる**。

(b) の実装は「初回だけ password でサインインして provider の subject を登録し、以降は
OIDC」という enrollment 型です（`apps/server/src/services/open_id.ts` の
`afterCallback`）。enrollment は「すでにサインインしているセッション」からしか
できないため（未登録のあいだはログインページが password フォームを出し、パスワードが
ないと provider の subject を結び付けられない）、**人に一度パスワードを入力させる
必要があります**。このサンプルの目的（Ato のサインインだけで使え、Trilium 用の
パスワードを持たない）に合わないので、(a) を選びます。

(a) の代償は、**Ato 側でその Instance に 2 人目を追加すると、その人も開けてしまう**
ことです。このサンプルはその前提を守るために、organization に共有せず、メンバーも
追加しません。ホスト CLI の `import-bundle <owner の email>` だけで、owner 以外の
人はゲートウェイが拒否します（存在しない Instance と同じ 404、または 403）。

(a) では Trilium のパスワードは存在しません。初回の document 作成時、パスワード関連の
option は空のまま（`passwordVerificationHash` などは空。`resetPassword` と同じ状態）
で、`noAuthentication` がサインイン自体を不要にします。`/login` はアプリへ
リダイレクトするだけで、フォームを出しません。デフォルト値も既知の値も残しません。

## 仕組み

- 公式 image を digest で固定し、Runner の要求に合わせて 1 枚に平坦化します
  （read-only root、非 root uid 1000、VOLUME/ENTRYPOINT なし、小さな noexec
  `/tmp`）。image の `CMD`（`start-docker.sh`、root で動く Docker 用）は使いません。
- code は image の読み取り専用領域 `/usr/src/app` にあり、この workspace は
  `/app` に read-only でマウントされます。Node のサーバーは
  `/usr/src/app/main.mjs` です。
- state は `/var/lib/trilium` の 1 つで、Trilium の data directory そのものです。
  `document.db`（SQLite）、`config.ini`、`backup/`、`session_secret.txt` が
  入ります。ログ・一時ファイル・OCR キャッシュ・anonymized DB は `/tmp` に逃がし、
  checkpoint の対象にしません。
- **初回起動は人に操作させません。** 空の data directory でサーバーを起動し、
  `/api/health-check` が 200 になったあと、setup ウィザードの「create new document,
  empty」と同じ `POST /api/setup/new-document?skipDemoDb` を localhost に投げて
  document を作ります。後の起動では初期化済みなので何もしません。
- 起動のたびに、Trilium のログインが切れていること（`/bootstrap` が
  `loggedIn: true`、`/login` が 302）、note API がセッションなしで 200 になる
  ことを確認してから serving します。どれか欠けると非 0 で終了し、Runner が Run を
  再起動します。
- バックアップは **daily のみ・圧縮**に設定し、state の `backup/` は起動時と
  稼働中（5 分ごと）に「最新の 1 つ」だけ残して削ります。Ato の checkpoint は
  非圧縮 tar で 64 MiB までなので、ノートが増えてもそれは document.db の分だけです。
- 同期は使いません。`syncServerHost` / `syncProxy` は毎起動空に戻します。ノートを
  外部の同期サーバーへ送る設定は残りません。
- 契約の観測は `/api/health-check`（200、サインイン不要）です。Trilium 自身の
  HEALTHCHECK と同じルートで、server が document を触る前に答えられます。
- Instance ごとの secret（`documentSecret`、`session_secret.txt` など）は、初回起動
  時に Trilium がその Instance の state の中で生成します。外から Binding として渡す
  secret はありません（パスワードも OIDC client secret も持たないため）。

## image を build する

Runner は workload を read-only・非 root で動かし、`VOLUME` や `ENTRYPOINT` を
宣言した image を受け付けません。公式 image を digest で固定して 1 枚に平坦化するだけで、
追加の Dockerfile はありません（Node 24 とビルド済みサーバー・assets が入っています）。

```sh
cd samples/trilium-ato-personal

# 公式 image の manifest list とプラットフォームごとの digest（2026-11-08 公開）
#   triliumnext/trilium:v0.107.0  index        sha256:739ba0f0488f506549f7c21dc9e792decd99382cc759f01d5ec1abba32e87da8
#                                 linux/amd64  sha256:ac72ce66f562a1d6d1baedf7d5c1672f19c3ba1b048603e50c8fc8114c80c502
#                                 linux/arm64  sha256:07a65ffe23c708f9b67a3d2f0f260b5bbf960c8a4c47dc450afd73a0c1488f9e
# （同じ manifest list に linux/arm/v7 と linux/arm/v8 もあります。このサンプルは
#   Runner が動く amd64 / arm64 の 2 つだけを対象にしています）
docker buildx imagetools inspect triliumnext/trilium:v0.107.0

TRILIUM_IMAGE=triliumnext/trilium:v0.107.0@sha256:07a65ffe23c708f9b67a3d2f0f260b5bbf960c8a4c47dc450afd73a0c1488f9e \
  ./build-images.sh linux/arm64
# → localhost/ato-e2e/trilium-next-flat@sha256:...（digest-pinned な参照）
```

## capsule.toml を生成する

`capsule.toml` は Instance ごとに変わる image 参照と platform を含むので commit
せず、`render.sh` で生成します。このアプリは公開 URL（redirect URI や自分の絶対
URL）を必要としないため、`render.sh` に URL の引数はありません。

```sh
APP_IMAGE=localhost/ato-e2e/trilium-next-flat@sha256:...   # build-images.sh の出力
./render.sh "$APP_IMAGE" linux/arm64 > capsule.toml
```

## セルフホスト Ato に、ある人の Instance としてインストールする

secret Binding はありません（Trilium のパスワードも OIDC client も使わないため）。
bundle を作り、**その人の email を owner にして** import します。

```sh
# 1. bundle を作る（sample の directory で）
ato pack . -o trilium.capsule

# 2. その人を owner として import する（organization には共有しない）
selfhost upload-bundle "$OWNER" < trilium.capsule        # → BUNDLE
selfhost import-bundle "$OWNER" "$BUNDLE" --runner "$RUNNER"

# 3. その人の Library から開く。他の人には見えず、インストール owner も開けない
```

`$OWNER` はその人の Ato アカウントの email です。owner をインストールした人
（管理者）にするのではなく、必ずノートの持ち主にしてください。共有はしません
（`share-app-with-org` も `add-app-member` も使わない）。

## 確認したこと

2026-11-23 にローカルの Lima VM（arm64、linux/arm64、1 Run per Runner）で確認しました。

- digest 固定の公式 image を `build-images.sh` で平坦化し、read-only・非 root
  （1000:1000）・1 state・64 MB の noexec `/tmp` で起動して `/api/health-check`
  が 200、空の state から document が非対話で作られ、`/login` が 302（フォームを
  出さない）こと。
- Instance を Ato の Library から開くと Trilium のサインインを経ずに
  `/bootstrap` が `loggedIn: true` を返し、UI と同じ HTTP API
  （`/api/notes/root/children` → `/api/notes/:id` / `:id/blob`）でノートを作成・
  読み返せること。これは 2 つの Instance それぞれで確認しました。
- 互いの Instance を開けないこと。Instance A のメンバーは bob だけ、Instance B の
  メンバーは carol だけにして、bob が B を開くと 404、carol が A を開くと 404 で
  ゲートウェイに拒否されること。
- README だけを変えた rebuild への in-place update が state を checkpoint / restore
  して完了し（`state: completed`、`checkpoint_revision_id` が採番）、bob のノートが
  更新後も残ること。
- state は A が `du` で約 596 KiB、checkpoint が pack する非圧縮 tar で
  604,160 bytes、B も `du` で約 596 KiB、非圧縮 tar で 604,160 bytes でした
  （ノート 1 件ずつ・document.db 576 KiB）。どちらも上限 64 MiB
  （`MAX_STATE_ARTIFACT_BYTES`）の内側です。

### この VM で確認できなかったこと（環境の制約）

- この VM の Ato テストユーザー bob / carol は **自分の Connected Runner を持って
  いません**。セルフホストのホスト CLI は「その人の Runner」にしか import できない
  ため、`import-bundle bob@example.com ... --runner <alice の Runner>` は
  `Runner ... is not a connected Runner of bob@example.com` で拒否され、PWA 経由の
  managed placement も `owned_runner_placement_required` で拒否されます。
- そのため上の確認では、Instance A / B を（この環境で唯一 Runner を持つ）インストール
  owner の alice として import し、A には bob、B には carol をメンバーとして 1 人
  だけ追加しました。結果として alice は両方の Instance の owner になり、**「インス
  トール owner が他人の Trilium を開けない」ことはこの VM では確認できていません**
  （サンプルの前提は上の「インストールする」のとおりで、owner を本人にする必要が
  あります）。
- 2 つ目の Instance の import は、1 つ目の state volume の checkpoint / restore が
  進行中のあいだ `user_runner_no_capacity` で一時的に拒否されました。1 つ目の
  更新が完了した後の再試行では成功しています。

## 制限

- **人どうしの共有はありません。** 1 Instance は 1 人だけのもので、他の人とノートを
  共有する機能はありません。共有したくなったら別のアプリ（BookStack など）を選んで
  ください。
- **このサンプルの前提では、インストール owner も他人の Instance を開けません。**
  所有者は import したその人で、organization に共有していないためです。管理者ができるのは Instance の
  停止・削除などの運用で、ノートの内容を読むことではありません。ただし逆に、owner で
  import しなければその保証はありません（上の手順を守ってください）。
- 2 人目を Ato 側で追加すると、その人は開けてしまいます（サインインの選択 (a) の
  代償）。追加しないでください。
- ノートの増加は state の checkpoint（非圧縮 tar 64 MiB）に比例します。document.db
  が 64 MiB に近づいたら、in-place update の代わりにノートを export（Trilium の
  backup / export）して新しい Instance に移してください。バックアップは最新 1 つ
  だけ残す設定で、これは state を守るためのものです。
- Trilium のパスワードは存在しません。忘れた・変えたいという操作もありません。
  `noAuthentication` を切るとログインフォームが出ますが、パスワードがないので
  入れません（このサンプルの設定に戻すとまた開けます）。
- UI の WebSocket 通知は Ato のアプリプロキシ越しで動かない可能性があります
  （Uptime Kuma サンプルで upgrade が 502 になった記録があります）。画面の読み書きは
  HTTP API で成立しますが、複数タブの即時反映などは環境により遅れることがあります。
- 更新直後は、アプリが起動してゲートウェイが転送を始めるまで数秒間 503 になること
  があります。開き直すか数秒待つと 200 になります。この確認では同じ経路で再試行して
  ノートが残っていることを確認しました。
- image の確認は arm64 のみです。amd64 の digest は同じ tag の manifest から固定して
  いますが、amd64 の Runner での build・import・E2E は未検証です。
- Trilium は HTTP で待ち受け、TLS は Ato のゲートウェイが終端します。この image を
  Ato の外で直接公開しないでください（サインインがないため、公開すると誰でも読めます）。
