# Task Board の個人・共有 DataResource 検証（2026-11-12）

## 検証対象

| 項目 | 値 |
| --- | --- |
| Instance | `cinst_01M77SSE9Y0A43XWD0N3M7PJEH` |
| Schema | `csch_01M77SSB1A9E36ZWXQA5VRWWYG` |
| Shared Resource | `dres_aa53c59420a64185b18cafe635b76483` |
| A / B の Personal Resource | `dres_b70550bdca364b59a06e8942955d0136` / `dres_ccca4c7dad2648e19bf9e061a9852398` |
| staging API Worker | `785d77e4-d995-45b5-bf58-a7637a0b4f4d`（開始・終了時とも 100%） |
| staging PWA エントリー | `main-fwLqh-l4.js`（開始・終了時で一致） |
| Instance の配信 Asset | `sha256:b1781a64d3ca4bb2e5b436d75066a9d6a3a3bd960b28e104796e50eb8efd4f1d` |

[検証対象の staging Task Board](https://cinst-5l76bin2kzqtom3u.stg-app.ato.run/)

## 拒否の原因と復旧

B の Binding は active だったが、親 Grant `dgrant_e2e_0` は
`scope_kind=document` で Operation の許可行が 0 件だった。
`authorizeResourceOperation` が Grant を拒否していた。Resource head は存在し、
Port の宣言、レジストリ、Resource に固定された実装ダイジェストは共有の 13 Operation
すべてで一致した。A が所有者として `POST /v1/data-resources/:id/grants` で B の
許可リストを更新すると、A/B とも `todo_shared_board` で同じ共有タスク 2 件を取得できた。

`todo_shared_update` に渡す ID は Resource 内の `t1`。検証対象の画面は
`shared_tasks:t1` を Port の特定に使う。Operation の必須入力は `id` と ISO 形式の
`at`。更新時の head revision と generation は API が照合する。

取消テストでは所有者の Grant API が B の Grant と Binding を失効させた。
再付与後、既存 Worker の候補 API は Operation Grant を持つ B の Shared を候補に
含めなかった。検証用 Instance の B の共有 Binding 1 行を staging D1 で復旧した。
復旧した Binding は `dbind_14d992ea05aec01943ddd9109efea16b`、新しい親 Grant は
`dgrant_a0eabd5c43d94fabad39533b74ca5195`。親 Grant は共有の 13 Operation を許可し、
文書スコープへの切り替えは行っていない。

接続候補と接続判定で Operation Grant を扱い、既存の許可リストを維持する API
修正は dev 向け PR に分けた。 [ato-api #1241](https://github.com/ato-run/ato-api/pull/1241)

## 配信中のアプリでの結果

| 実 Chrome での操作 | 結果 |
| --- | --- |
| A が Tickets のステータス操作で共有タスクを移動 | HTTP 200、共有 revision 4。B のボード再取得で変更を確認 |
| B が共有タスクを元の列へ移動 | HTTP 200、共有 revision 5。A のボード再取得で変更を確認 |
| A/B がそれぞれ個人用タスクを作成 | どちらも HTTP 200。相手のボードを再取得しても個人用タスクは表示されなかった |
| A が B の共有 Grant を取消 | HTTP 200。B の再取得で共有タスクが消え、B の個人タスクと A の共有タスクは引き続き表示された |
| デスクトップ幅 1440 px / モバイル幅 390 px | 既存セッションを読み込んだ新しい Chrome コンテキストで両方のボードを表示できた |
| セッションなしで Instance の Port 情報を取得 | HTTP 401 |

A/B の検証用個人タスクは削除済み。B の共有接続は復旧済み。
実際の再ログインと C のセッションは未検証。既存の別 Instance
`cinst_01M72JS752NMD7VC5GA70MHB0W` および本番への変更はなし。

## dev 向けサンプルの検証と配備差分

- `origin/dev` の Task Board では、既存の Resource chooser を Personal / Shared で
  共用し、選択中のボードに対して編集する。配信中の検証用アプリには統合表示もある。
- API の Port / Operation コンパイラで `tasks` 15 件と `shared_tasks` 13 件を検証。
  既存の投影は nullable な出力を維持するため、単一型のみを受理する v2 の出力宣言を
  省略した。Node テストは 15 件成功。
- 実 Chrome にローカルの候補 Asset を読み込ませ、staging の既存 Operation を使って
  A/B の切り替えと読み取りを確認した。前アカウントのローカルデータが読み込み中に
  表示されないこと、更新の送信先・ID・時刻、共有の 404 を模した応答で表示が消える
  ことも確認した。
- staging の `todo.board@1` レジストリと候補を照合すると、共通の 26 Operation の
  実装ダイジェストが異なり、既存の選択タスク投影に関する 2 Operation は未登録だった。
  この状態で同じプロトコルの登録を上書きすると既存 Resource の固定値と衝突する。
  候補ソースの Formation publish と配備は未実施。
- API の staging 自動ジョブは課金制限で開始前に終了した。Worker の実測とローカルの
  検証結果は上記のとおり。 [staging ジョブ](https://github.com/ato-run/ato-api/actions/runs/43216228126)
