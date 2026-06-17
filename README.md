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
| `LINE_CHANNEL_ACCESS_TOKEN` | 将来のMessaging API送信用 | 必須 |
| `NEXT_PUBLIC_LIFF_ID` | 将来のLIFF連携用 | 任意 |

テスト用LINE公式アカウントのMessaging APIチャネルで、Webhook URLを次のURLに
設定してください。

```text
https://<Vercelのドメイン>/api/line/webhook
```

VercelのProject SettingsにあるEnvironment Variablesへ上記の環境変数を設定し、
再デプロイします。その後、LINE DevelopersコンソールでWebhookの「検証」を実行し、
成功することを確認してください。

環境変数の設定状態は、秘密値を表示しない次のエンドポイントで確認できます。

```text
https://<Vercelのドメイン>/api/line/health
```

本番LINE公式アカウントへ切り替える際は、Vercelの環境変数を本番チャネルの値へ
差し替えて再デプロイし、本番チャネル側のWebhook URLを設定します。コード変更は
不要です。

現在のWebhookは署名検証とイベント受信のみ行います。メッセージ返信、配信、
自動配信、イベントのDB保存はまだ行いません。

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
