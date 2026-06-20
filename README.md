# SwitchBot Dashboard

SwitchBot API v1.1 を使う個人用ダッシュボードです。Cloudflare Pages Functions が API 署名を作って SwitchBot に中継し、ブラウザ側には token / secret を置かない構成です。

Production: https://switchbot-dashboard.pages.dev

## セットアップ

1. SwitchBot アプリで token / secret を取得します。
   - Profile > Preferences > About
   - App Version を複数回タップ
   - Developer Options > Get Token
2. `.env.example` を `.env` にコピーして値を入れます。
3. ローカル起動します。

```powershell
cd C:\work\Claude\switchbot-dashboard
copy .env.example .env
npm start
```

ブラウザで `http://localhost:8091` を開きます。

## できること

- 物理デバイスと赤外線リモコンの一覧表示
- 物理デバイスの状態取得
- 温湿度、CO2、電池、電源、ロック状態など主要値のカード表示
- 手動シーンの一覧と実行
- よく使う `turnOn` / `turnOff` / `press` などの基本コマンド送信
- Cloudflare Pages 上ではパスワードログインで保護

## 注意

- SwitchBot API は個人利用向けで、日次呼び出し制限があります。自動更新間隔は長めにしています。
- public repository や静的サイトに `.env`、token、secret、ログインパスワードを置かないでください。
- 本番の秘密情報は Cloudflare Pages の環境変数に置きます。
- SwitchBot API の戻り値は機種ごとに違うため、カード下部に raw status も表示します。

## Cloudflare 環境変数

- `SWITCHBOT_TOKEN`
- `SWITCHBOT_SECRET`
- `AUTH_PASSWORD`
- `AUTH_SECRET`

## Notion

- AI DB page id: `3854b6f3-2895-8156-bcbd-c5a4b32c9d4a`
- コミットDB: GitHub Actions の `notion-commit.yml` で push 時に記録
