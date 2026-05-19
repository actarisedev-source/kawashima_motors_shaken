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

開発サーバーを起動します。

```bash
npm run dev
```

ブラウザで以下にアクセスします。

```text
http://localhost:3000
```

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
