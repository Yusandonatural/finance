# finance — 悠三堂 銀行提出用 月次試算表アプリ

freee会計のデータから、月末棚卸未実施を補正した銀行提出用の月次試算表パッケージを作るアプリ。
現在は **設計フェーズ**（実装未着手）。

| ドキュメント | 内容 |
|---|---|
| [docs/00_request.md](docs/00_request.md) | 依頼内容の整理（原文の手直し版） |
| [docs/01_design.md](docs/01_design.md) | 設計図（要件・アーキテクチャ・棚卸補正ロジック・データ・API・画面・帳票） |
| [docs/02_project_plan.md](docs/02_project_plan.md) | 制作予定書（フェーズ・スケジュール・役割・準備物） |
| [docs/03_handover.md](docs/03_handover.md) | 引き継ぎ書（前提知識・決定事項・既知の課題・次の手順） |

構成（予定）: Cloudflare Workers (Hono, TypeScript) + D1 + R2、フロントは Vite + Preact。
