# SwitchBot Dashboard

Cloudflare Pages にデプロイする個人用 SwitchBot ダッシュボード。

## 秘密情報

- SwitchBot の token / secret は `.env` にだけ保存する。
- `.env` は git 管理しない。
- public repository や静的ホスティングに token / secret / login password を置かない。
- 本番秘密情報は Cloudflare Pages の環境変数に置く。

## 開発

```powershell
npm start
```

ブラウザで `http://localhost:8091` を開く。

## デプロイ

- コード変更後は確認なしに `git commit & push` する（main → Cloudflare Pages 自動デプロイ）。
- コミットメッセージは ASCII で書く。

## API 方針

- SwitchBot API v1.1 を使う。
- ブラウザから SwitchBot API を直接叩かず、`server.js` で署名して中継する。
- 本番は `functions/api/[[path]].js` で署名して中継する。
- 本番は `AUTH_PASSWORD` によるログイン必須にする。
- API エラーは HTTP status、SwitchBot `statusCode` / `message`、method、path を `console.log` に出す。

## Notion

- AI DB page id: `3854b6f3-2895-8156-bcbd-c5a4b32c9d4a`
- コミットDB workflow を必ず維持する。
