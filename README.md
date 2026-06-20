# Kawashima Motors Shaken

川島モータース向け車検予約システムです。

## 技術構成

- Next.js App Router
- TypeScript
- Tailwind CSS
- ESLint
- Supabase

## ローカル起動方法

依存関係をインストールします。

```bash
npm install
```

環境変数ファイルを作成します。

```bash
cp .env.local.example .env.local
```

`.env.local` に Supabase などの接続情報を設定してください。

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
NEXT_PUBLIC_LIFF_ID=
NEXT_PUBLIC_RESERVATION_LIFF_ID=
LINE_LOGIN_CHANNEL_ID=
CRON_SECRET=

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` は、LINE Developers
コンソールの Messaging API チャネルから取得します。`NEXT_PUBLIC_LIFF_ID` は
LIFFを利用するときだけ設定してください。

開発サーバーを起動します。

```bash
npm run dev
```

ブラウザで以下にアクセスします。

```text
http://localhost:3000
```

## LINE連携基盤

LINE公式アカウント固有の情報はコードに保持せず、次の環境変数で切り替えます。

| 環境変数 | 用途 | 必須 |
| --- | --- | --- |
| `LINE_CHANNEL_SECRET` | Webhook署名検証 | 必須 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 手動・自動LINE配信 | 配信時は必須 |
| `NEXT_PUBLIC_LIFF_ID` | 顧客LINE連携ページのLIFF ID | 顧客連携時は必須 |
| `NEXT_PUBLIC_RESERVATION_LIFF_ID` | LINE内予約用のLIFF ID | LINE内予約時は推奨 |
| `LINE_LOGIN_CHANNEL_ID` | LINE IDトークンの検証に使うLINE LoginチャネルID | 顧客連携時は必須 |
| `CRON_SECRET` | LINE自動配信Cron APIの認証 | 自動配信時は必須 |

テスト用LINE公式アカウントのMessaging APIチャネルで、Webhook URLを次のURLに
設定してください。

```text
https://<Vercelのドメイン>/api/line/webhook
```

VercelのProject SettingsにあるEnvironment Variablesへ上記の環境変数を設定し、
再デプロイします。その後、LINE DevelopersコンソールでWebhookの「検証」を実行し、
成功することを確認してください。

Production環境には、Messaging APIチャネルの「チャネルシークレット」を正確に
`LINE_CHANNEL_SECRET`という名前で登録します。登録後は
`/api/line/health`の`configuration.webhook`が`true`になります。正常な署名付き
Webhookは200、不正な署名または署名なしのリクエストは401で拒否されます。

環境変数の設定状態は、秘密値を表示しない次のエンドポイントで確認できます。

```text
https://<Vercelのドメイン>/api/line/health
```

本番LINE公式アカウントへ切り替える際は、Vercelの環境変数を本番チャネルの値へ
差し替えて再デプロイし、本番チャネル側のWebhook URLを設定します。コード変更は
不要です。

現在のWebhookは署名検証とイベント受信を行います。管理画面の手動配信と、
Vercel Cronによる車検・予約リマインドの自動配信に対応しています。

### LINE自動配信

`/admin/line`の「自動配信設定」タブで通知ごとの有効状態、本文、配信時刻を設定します。
Vercel HobbyではCronを日本時間09:00に1日1回起動し、設定時刻を過ぎた未実行の通知だけを処理します。
細かな時刻指定を使う場合は、Proまたは外部スケジューラから15分間隔でAPIを起動してください。
同じ顧客・車両または予約・通知種別への同日重複送信は配信ログで防止します。

VercelのProduction環境へ十分に長いランダム値の`CRON_SECRET`を設定してください。
Cron APIは次のエンドポイントです。

```text
GET /api/cron/line-automations
POST /api/cron/line-automations
Authorization: Bearer <CRON_SECRET>
```

### 顧客LINE連携

LIFFアプリのEndpoint URLを次のURLに設定し、Scopeで`openid`と`profile`を
有効にしてください。

```text
https://<Vercelのドメイン>/reservations/line-link
```

顧客LINE連携では、LIFFから取得したIDトークンをサーバー側で検証した後、入力された
電話番号と`customers.normalized_phone`を照合します。既存顧客との紐付けだけを行い、
一致しない場合に新しい顧客は作成しません。顧客情報を扱うため、連携APIでは
`SUPABASE_SERVICE_ROLE_KEY`も必須です。

### LIFF内予約の自動連携

予約用LIFFアプリのEndpoint URLには予約フォームのURLを設定し、Scopeで`openid`と
`profile`を有効にしてください。

```text
https://<Vercelのドメイン>/
```

リッチメニューには通常のWeb URLではなく、次のLIFF URLを設定します。

```text
https://liff.line.me/<予約用LIFF_ID>
```

予約フォームは`NEXT_PUBLIC_RESERVATION_LIFF_ID`を優先して使用し、未設定の場合は
`NEXT_PUBLIC_LIFF_ID`へフォールバックします。LIFF内では予約時にIDトークンを
サーバーへ送り、電話番号で見つかった顧客が未連携の場合にLINE情報を自動保存します。
外部ブラウザやPCではLINE情報なしで従来どおり予約できます。

## よく使うコマンド

```bash
npm run lint
npm run typecheck
npm run build
```

## GitHub リポジトリ作成と push 手順

このリポジトリは `main` ブランチで管理します。

### 1. GitHub で repository を作成

GitHub にログインし、以下の手順で新規 repository を作成します。

1. GitHub の右上にある `+` から `New repository` を選択
2. Repository name に `kawashima_motors_shaken` を入力
3. Public / Private を選択
4. `Add a README file`、`.gitignore`、`license` は選択しない
5. `Create repository` をクリック

### 2. remote origin を設定

GitHub で repository 作成後、表示される URL を使って remote を設定します。

HTTPS の場合:

```bash
git remote add origin https://github.com/<your-account>/kawashima_motors_shaken.git
```

SSH の場合:

```bash
git remote add origin git@github.com:<your-account>/kawashima_motors_shaken.git
```

設定できたことを確認します。

```bash
git remote -v
```

### 3. initial commit を作成

```bash
git add .
git commit -m "Initial commit"
```

### 4. GitHub へ push

```bash
git push -u origin main
```

2 回目以降は以下で push できます。

```bash
git push
```
