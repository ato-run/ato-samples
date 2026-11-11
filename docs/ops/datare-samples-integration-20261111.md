# ato-samples: #8/#9/#10 の重複解消と dev/stg 統合 — 2026-11-11 JST

対象 repo: `apps/ato-samples`。この記録は #8/#9/#10 をファイル単位・挙動単位で比較して
重複を除外し、残る新規分だけを dev に載せた判断と、実行した検証の結果である。
production の変更・データ移行・flag 変更・migration は行っていない。

作業 worktree: `apps/ato-samples/.worktrees/datare-pr10`（#10 の rebase）、
`apps/ato-samples/.worktrees/datare-docs`（この記録）。既存 worktree は変更していない。

## 1. 参照 SHA

| 参照 | SHA |
| --- | --- |
| 比較基準 origin/dev（作業開始時） | `24ed7a34cc4da71679be1090acbe2b2b460b1392` |
| 比較基準 origin/stg（作業開始時） | `2109d2aa1232edfc442f50dad4f7c4dcfe321b27` |
| 比較基準 origin/main（作業開始時） | `52f9a1855f800f7d8e8d788b20b07a4b92020a24` |
| #11 merge（operation-scoped TODO/Calendar） | `9ff36bee8ed46d7c714acd28b20075f6ebf67f48` |
| #12 merge（Excalidraw scene operations） | `ebc09cde05bb996562987d3562ab6bf15221a816` |
| #13 merge（capsule v2 authoring） | `9ca100482668c33aa2150c7b1e4bb0344c7d05e3` |
| #8 head `feat/g1-shared-json-contract` | `bf0759cf8f5d2af29929f66e803bb8975ce0f6be`（2 commits: `6220fcb`, `bf0759c`） |
| #10 head（rebase 前 → 後） | `a7b7263c6afd4ea7639633bf64fc036557fdad53` → `b6028a9e5d5a90c7dc802a874dc224fec2cc1e20` |
| #10 merge commit（dev） | `0e5d734eafc7d8897a7b9e7f803f6bfb75977dd2` |
| #48 dev→stg 昇格 merge（stg） | `fc014b9ade2ac7e30b2c4b20a234f5f5017c8675` |
| #9 head（DRAFT 維持） | `e95617ac29a7452c301bd64d759020e5cb2139d5` |
| #8/#11/#12/#13 の分岐点 | `cd6f0c679d70db65d0e1f2c49b436c46fb86c4b4` |

#8/#11/#12/#13 は**同じ分岐点 `cd6f0c6`（nightly）から切られた兄弟ブランチ**である。
#11 の commit は #8 の約 8 時間後で、#8 の内容を置き換える形に拡張されて dev へマージされた。

## 2. 判定表

| PR | base（変更前→後） | dev に対する差分 | 重複判定 | 決定・結果 |
| --- | --- | --- | --- | --- |
| #8 `feat/g1-shared-json-contract` | dev（変更なし） | dev に含まれない commit は 2 つ。ただし内容は #11 が包含（§3.1） | **重複（superseded）** | superseded として close（branch は残す） |
| #10 `feat/team-selected-sharing` | `feat/g1-shared-json-contract` → **`dev`** | 3 files / +126 / -0（§3.2） | **新規**（dev に `todo_list_shared`/`todo_set_shared` は無い） | dev へ rebase して push（`b6028a9`）→ #10 merge `0e5d734` → #48 で stg `fc014b9` |
| #9 `feat/task-board-project-views`（DRAFT） | `feat/g1-shared-json-contract` | 19 commits / 36 files / +8441（§3.3） | **新規だが競合大・Draft** | Draft 維持。rebase・merge はしない（後続タスク） |

## 3. 根拠（ファイル・挙動単位）

### 3.1 #8 は #11 の部分集合

`git show origin/dev:samples/shared-json-todo/...` と `bf0759c` を同一パスで比較した。

- operation id: **13 個が完全一致**（`todo_board`, `todo_list`, `todo_get`, `todo_get_by_number`,
  `todo_create`, `todo_update`, `todo_move`, `todo_delete`, `todo_archive_done`,
  `todo_initialize`, `todo_reset`, `todo_replace_board`, `todo_list_due_dates`）。
- `src/operations/todo.js` の export: **13 個が完全一致**（`boardDocument`, `listTodos`,
  `getTodo`, `getTodoByNumber`, `createTodo`, `updateTodo`, `moveTodo`, `deleteTodo`,
  `archiveDone`, `initializeBoard`, `resetBoard`, `replaceBoard`, `listDueDates`）。
- `samples/shared-json-todo/ato.data.toml`: **dev と #8 で完全同一**（`ato.data-ports/1` /
  `tasks` / `todo.board@1` / `scope=user` / `access=read_write`）。
- dev の方が広い: `schema.jsonc`（非実行の description。RFC I11 により実行根拠にしない）、
  `fixtures/legacy-store-capsule.toml`（negative Formation fixture）、`capsule.toml` の
  `ato.capsule/2` 化（#13）、FullCalendar vendor（#36）、Excalidraw null-safe（#39/#42）。
- #8 を rebase してなお残る差分は 3 種類だけ:
  1. **`samples/shared-json-calendar/ato.data.toml` の `scope` を `user` → `instance` に変える**。
     operation-only Port の接続相手を「利用者個人」から「Instance 共有」へ変える挙動変更で、
     dev で動いている product flow に対する**退行**にあたる（`ato-api` の authorize predicate は
     両 scope を受理するが、product の同意は利用者単位）。
  2. `schema.jsonc` の削除（説明用の非実行テキスト。消す必要がない）。
  3. `fixtures/legacy-store-capsule.toml` x2 の削除（negative fixture を失う）。
- 結論: 保全すべき新規内容は無い。#8 は却下ではなく **#11 により superseded**。

### 3.2 #10 の dev に対する差分（マージされた内容そのもの）

`git diff --stat origin/dev b6028a9` → `3 files changed, 126 insertions(+)`（削除 0）

| ファイル | 追加 | 内容 |
| --- | --- | --- |
| `samples/shared-json-todo/ato.operations.yaml` | +77 | `todo_list_shared`（observation, `state.access: read`）と `todo_set_shared`（evolution, `read_write`）。どちらも既存 `tasks` Port への宣言。新しい Port と `ato.data.toml` の変更は無い |
| `samples/shared-json-todo/src/operations/todo.js` | +32 | `listSharedTasks` / `setTaskSharing`。`commit()` を通じて `replace` 1 回で書き戻す |
| `samples/shared-json-todo/README.md` | +17 | 共有は Grant（operation-only Port を 1 Instance に接続）で行い、document read・他 operation・private タスクへ到達できないこと、unshare 後は次回呼び出しで見えなくなること |

rebase 前の #10 は #8 の上に積まれていたため差分に #8 の書き換えが混ざっていた。
rebase では dev の新しい README / operations 配置（`todo_list_due_dates` が先頭）に合わせて
競合 2 件（README, ato.operations.yaml）を解消し、重複する `todo_list_due_dates` ブロックは
dev 側を採用して落とした。`todo.js` は自動マージ。**既存サンプルファイルの削除は無い（-0）**。

### 3.3 #9 の内容（Draft 維持）

19 commits / 36 files / +8441。WBS・ガント・月/週カレンダー、projects-v2 profile
（`ato.data.toml` + `ato.operations.yaml` + `schema.jsonc` + `todo-v1/v2.js`）、
`team_tasks` Port（`scope=instance`, `access=operations`）と `todo_team_*` 13 operation、
workspace UI。新規価値はあるが、dev が現在持つ `app-1..7.js` / `index.html` /
`operation-client.js` / `ato.operations.yaml` / `ato.data.toml` を同時に書き換えるため、
rebase は全面衝突になる。Draft のまま据え置き、別タスクで dev へ載せ替える。

## 4. 契約整合（operation-scoped Port / CAS / `operation_id`）

`ato-api` #1155（`feat(data-resources): operation-scoped DataResource access and the TODO→Calendar vertical`,
merged 2026-11-10）が定める `ato.data-ports/2` + `access = "operations"` の意味論に対して確認した。

- **Port**: dev の TODO は従来どおり document Port（`ato.data-ports/1`, `read_write`）、
  Calendar だけが operation-only Port（`ato.data-ports/2`, `access=operations`,
  `operations=["todo_list_due_dates"]`）。#10 は `ato.data.toml` を変更せず Port を増やさないため、
  Port / Grant の移行を伴わない。
- **分類**: `semantics` は Protocol が所有し、`evolution` ⇔ `state.access=read_write`、
  `observation` ⇔ `access=read` が全 15 operation で成立（機械チェック済み、§5）。
- **CAS / 冪等性**: `expected_revision` と `operation_id` は runtime 封筒の責務で、
  operation 宣言の input に混ぜない。dev の既存 evolution（`todo_update` 等）と同じ形で、
  `todo_set_shared` も宣言していない。`commit()` は revision を +1 して
  `{kind:"replace"}` を 1 回だけ返す（原子的判定の前提を崩さない）。
- **投影**: `todo_list_shared` の output schema は閉じた 5 フィールド
  （`task_id`, `number`, `title`, `status`, `due_at`）で、description / subtasks /
  recurrence を構造的に運べない。unshare は次回 Observation で即時に効く（revoke 可能）。

### Detected mismatch（この repo では直さない）

- `ato-api` の参照 fixture `tests/fixtures/data-port-vertical/calendar/ato.data.toml` は
  operation-only Port に `scope="instance"` を使うが、ato-samples dev の
  `samples/shared-json-calendar/ato.data.toml` は `scope="user"` である。
  `ato-api` の authorize predicate は両方を受理する（user は grant subject=user、
  instance は `SHARE_WITH_INSTANCE` 承認が必要）ため契約違反ではないが、
  product の同意 flow と参照 fixture の前提がずれている。どちらを正とするかは人間の判断。
  ここでは dev の現状（`user`）を変更していない。

## 5. 検証（PASS / FAIL / BLOCKED）

| # | コマンド / 対象 | 結果 |
| --- | --- | --- |
| 1 | `python3 .tmp/datare-qa/validate_sample.py` | **PASS**（30 checks, FAILS=0）: `ato.operations/v2` / `state_write_policy=operations_only` / id 重複なし（15）/ 新 operation の semantics・access・port・export / export が handler に実在 / 入出力が閉じた schema / CAS・`operation_id` が宣言に混入していない / evolution⇔read_write / 投影 5 フィールド |
| 2 | `node .tmp/datare-qa/smoke-sharing.mjs .tmp/datare-qa/todo.mjs` | **PASS**（18 checks, FAILS=0）: 共有タスクのみ返す / 5 フィールド以外を漏らさない（description, subtasks, priority, createdAt を検査）/ archived を返さない / unshare で `shared` と `sharedAt` が消え revision 4→5 / unshare 後の投影が空 / private タスクと本文は board に残る / 2 件目の共有が反映 / 未知 id で fail closed / 非 boolean の `shared` を共有扱いしない |
| 3 | `cd samples && npm ci --ignore-scripts && npm run validate` | **PASS**（12 サンプル）。ただし `samples/tools/validate-health.mjs` は tier 配下の `health.toml` のみ対象で、`shared-json-todo` は**この CI の対象外**（repo README の「CI は不完全」記述どおり） |
| 4 | `node --check`（`todo.js` を `.mjs` として、および `app-*.js` / `operation-client.js`） | **PASS**（構文） |
| 5 | `ato validate samples/shared-json-todo` | **BLOCKED**: 手元 CLI は `ato 0.5.5`。`capsule.toml` の `schema = "ato.capsule/2"` を解釈できず `E001 manifest_toml_parse: missing field \`name\``（exit 1）。`capsule.toml` は #10 で未変更（dev と同一）なので既存の環境制約 |
| 6 | ato `services/coordinator/e2e/team-sharing.mjs`（real SQLite Coordinator） | **NOT EXECUTED**: coordinator のビルド/起動が必要で、この作業範囲（ato-samples のみ）外。#10 本文のログは rebase 前の実行記録 |
| 7 | `gh pr view 10`（差分の形） | **PASS**: `changedFiles=3, additions=126, deletions=0` |
| 8 | CI `sample inputs`（`.github/workflows/verify.yml`, job `static-inputs`）on `b6028a9` | **PASS**: pull_request run `43028160920` success / workflow_dispatch run `43027945754` success。force-push 直後は旧 base（`feat/g1-shared-json-contract`）との merge ref が作れず pull_request run が生成されなかったため、base を dev に変更した後に reopened で同 SHA の pull_request run を実行した。billing 由来の失敗ではない |
| 9 | CI `sample inputs` on `0e5d734`（#48 の head） | **PASS**: pull_request run `43028373616` success（mergeable=CLEAN でマージ） |
| 10 | `npm run validate`（billing / skip の確認） | 課金由来の失敗アノテーションは無し。skip された job も無し |

検証スクリプトと出力は workspace `.tmp/datare-qa/`（`validate_sample.py`, `smoke-sharing.mjs`,
`todo.mjs`, `ato-validate-todo.json`）。repo には含めない。

## 6. stg / release 規約（実測）

- 作業開始時点で `origin/stg` `2109d2aa` は `origin/dev` `24ed7a34` を祖先に含み（PR #46）、
  #11/#12/#13 の merge commit `9ff36bee`/`ebc09cde`/`9ca10048` も stg に含まれていた。
  `origin/main` `52f9a18`（PR #47）は stg を含む。
- 「ato-samples は staging pin を使い stg branch を使わない」という前提は**この repo では成立しない**。
  `stg` branch が実際の staging 候補で、dev→stg→main の PR と tag `v0.9.0`/`v0.9.1` で運用されている。
  `.github/workflows/` は `verify.yml` と `quickstart-bundle.yml` のみで、stg/main への push で
  deploy する workflow も、Release Manifest / staging pin ファイルも存在しない。
  よって「pin を追加する」作業は不要。
- 今回の昇格: #48（`dev` `0e5d734` → `stg`）を CI green + mergeable CLEAN で merge commit マージし、
  `origin/stg` = `fc014b9ade2ac7e30b2c4b20a234f5f5017c8675`。`origin/main` は変更していない
  （stg→main はリリース承認の別操作）。

## 6.1 #8 の扱い（実施記録）

- `#8` は **2026-11-11T13:23:45Z に superseded として close**（却下ではない）。close 前に、
  §3.1 の一致（13 operation / 13 export / 同一 `ato.data.toml`）と rebase 後に残る 3 差分
  （calendar の `scope` 退行、`schema.jsonc` 削除、legacy fixture 2 件の削除）を本文コメントに残した。
- branch `feat/g1-shared-json-contract` は **削除していない**（remote に `bf0759c` が残存）。
- 参考: #8 は dev が先に進んだため close 時点で `mergeable=CONFLICTING`。

## 7. 実行しなかったこと

- #8 の rebase（残る差分が退行と削除のみのため実施しない。branch は削除しない）。
- #9 の rebase / merge（Draft 維持）。
- real-Coordinator E2E の再実行、staging へのデプロイ、production への変更、データ移行、flag 変更。
- stg→main の昇格（リリース承認の範囲外）。
- ato-api / ato / ato-pwa など他 repo への commit。

## 8. 後続

- #9: WBS/Gantt/Roadmap + projects-v2 + `team_tasks` Port（19 commits）を dev の新しい
  `app-*.js` / `ato.operations.yaml` に載せ替える別タスク。
- `ato-api` 参照 fixture と ato-samples calendar の `scope` 不一致（§4 Detected mismatch）の扱い。
- 共有トグルの UI（#10 は operation と handler のみ。`app-*.js` は未変更）。
- この記録自体は PR #49（head `docs/datare-samples-integration-20261111`, base `dev`, +163 / 1 file）で
  CI `static-inputs` green・mergeable CLEAN を確認済み。マージは別途の承認で行う（#48 の昇格には含まれない）。
