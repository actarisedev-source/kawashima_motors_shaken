# 車検予約・顧客管理・LINE連携システム 初期設計

## 1. ディレクトリ構成

Next.js App Router を中心に、UI、API、DB、LINE 連携を分離します。

```txt
kawashima_motors_shaken/
  app/
    (admin)/
      dashboard/
        page.tsx
      customers/
        page.tsx
      vehicles/
        page.tsx
      reservations/
        page.tsx
      layout.tsx
    liff/
      page.tsx
    api/
      customers/
        route.ts
      vehicles/
        route.ts
      reservations/
        route.ts
      line/
        webhook/
          route.ts
      liff/
        link-customer/
          route.ts
    layout.tsx
    page.tsx
    globals.css
  components/
    admin/
      AppShell.tsx
      Sidebar.tsx
      Header.tsx
    calendar/
      ReservationCalendar.tsx
      ReservationCell.tsx
      ReservationDetailModal.tsx
    customers/
      CustomerForm.tsx
      CustomerTable.tsx
    vehicles/
      VehicleForm.tsx
      VehicleList.tsx
    ui/
      Button.tsx
      Card.tsx
      Dialog.tsx
      Input.tsx
      Select.tsx
      Textarea.tsx
  lib/
    supabase/
      client.ts
      server.ts
      admin.ts
    line/
      messaging.ts
      webhook.ts
      liff.ts
    auth/
      session.ts
    validators/
      customer.ts
      vehicle.ts
      reservation.ts
    utils/
      date.ts
      constants.ts
  types/
    database.ts
    customer.ts
    vehicle.ts
    reservation.ts
    line.ts
  supabase/
    schema.sql
    seed.sql
  docs/
    initial-design.md
  middleware.ts
  next.config.ts
  tailwind.config.ts
  package.json
  .env.local.example
```

### 設計方針

- GAS とスプレッドシートは使用しません。
- Supabase PostgreSQL を正式なデータソースにします。
- 将来的な多店舗化に備え、全主要テーブルに `tenant_id` を持たせます。
- 顧客、車両、予約、LINE プロフィールを分離し、後から通知履歴や自動配信を追加しやすくします。
- 管理画面は SaaS 型ダッシュボードとして、予約カレンダーを中心に構成します。

## 2. DB設計

### tenants

店舗・事業者単位のテーブルです。初期は 1 店舗でも、将来的な多店舗展開の軸になります。

| column | type | note |
| --- | --- | --- |
| id | uuid | 店舗ID |
| name | text | 店舗名 |
| slug | text | URLや識別子に使う短い名前 |
| created_at | timestamptz | 作成日時 |
| updated_at | timestamptz | 更新日時 |

### customers

顧客情報を管理します。

| column | type | note |
| --- | --- | --- |
| id | uuid | 顧客ID |
| tenant_id | uuid | 店舗ID |
| name | text | 名前 |
| name_kana | text | ふりがな |
| phone | text | 電話番号 |
| line_user_id | text | LINE userId |
| line_display_name | text | LINE表示名 |
| memo | text | メモ |
| created_at | timestamptz | 作成日時 |
| updated_at | timestamptz | 更新日時 |

### vehicles

1 顧客が複数台所有できる構造です。

| column | type | note |
| --- | --- | --- |
| id | uuid | 車両ID |
| tenant_id | uuid | 店舗ID |
| customer_id | uuid | 顧客ID |
| model_name | text | 車種 |
| license_plate | text | ナンバー |
| inspection_expires_on | date | 車検満了日 |
| memo | text | メモ |
| created_at | timestamptz | 作成日時 |
| updated_at | timestamptz | 更新日時 |

### reservations

同じ日時に複数予約できる前提で、日時にはユニーク制約を設けません。

| column | type | note |
| --- | --- | --- |
| id | uuid | 予約ID |
| tenant_id | uuid | 店舗ID |
| customer_id | uuid | 顧客ID |
| vehicle_id | uuid | 車両ID |
| reserved_at | timestamptz | 予約日時 |
| status | reservation_status | 受付中、確定、完了、キャンセル |
| note | text | 備考 |
| created_at | timestamptz | 作成日時 |
| updated_at | timestamptz | 更新日時 |

### line_profiles

LINE プロフィールと顧客の紐付けを管理します。follow イベント受信時点では顧客未確定の可能性があるため、`customer_id` は nullable にします。

| column | type | note |
| --- | --- | --- |
| id | uuid | LINEプロフィールID |
| tenant_id | uuid | 店舗ID |
| customer_id | uuid | 顧客ID |
| line_user_id | text | LINE userId |
| display_name | text | LINE表示名 |
| picture_url | text | アイコンURL |
| followed_at | timestamptz | 友だち追加日時 |
| unfollowed_at | timestamptz | ブロック・解除日時 |
| created_at | timestamptz | 作成日時 |
| updated_at | timestamptz | 更新日時 |

### notification_templates

将来の LINE 自動配信用です。

| column | type | note |
| --- | --- | --- |
| id | uuid | テンプレートID |
| tenant_id | uuid | 店舗ID |
| key | text | inspection_reminder 等 |
| name | text | 管理名 |
| body | text | 本文 |
| is_active | boolean | 有効状態 |
| created_at | timestamptz | 作成日時 |
| updated_at | timestamptz | 更新日時 |

### notification_logs

LINE 送信履歴です。予約確認、車検満了前通知、キャンセル通知などを記録します。

| column | type | note |
| --- | --- | --- |
| id | uuid | 通知ログID |
| tenant_id | uuid | 店舗ID |
| customer_id | uuid | 顧客ID |
| vehicle_id | uuid | 車両ID |
| reservation_id | uuid | 予約ID |
| line_user_id | text | 送信先LINE userId |
| template_key | text | テンプレートキー |
| body | text | 実際に送った本文 |
| status | text | queued, sent, failed |
| sent_at | timestamptz | 送信日時 |
| error_message | text | 失敗理由 |
| created_at | timestamptz | 作成日時 |

## 3. Supabaseテーブル設計

SQL は [supabase/schema.sql](../supabase/schema.sql) に定義しています。

主なポイント:

- `tenant_id` による多店舗対応
- `reservation_status` enum による予約ステータス制御
- `customers` と `vehicles` は 1:n
- `customers`、`vehicles`、`reservations` は明確に分離
- `line_profiles` は follow イベントと LIFF 紐付けの両方に対応
- 予約日時には unique 制約を置かず、同時間複数予約を許可
- 一覧・カレンダー表示に必要な index を事前定義
- 顧客、車両、予約、LINE プロフィールは `tenant_id` 付きの外部キーで店舗混線を防止

## 4. 型定義

初期実装では `types/` にアプリケーション型を置き、Supabase CLI 導入後に `types/database.ts` を自動生成型へ置き換えます。

```ts
export type ReservationStatus =
  | "受付中"
  | "確定"
  | "完了"
  | "キャンセル";

export type Customer = {
  id: string;
  tenantId: string;
  name: string;
  nameKana: string | null;
  phone: string | null;
  lineUserId: string | null;
  lineDisplayName: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Vehicle = {
  id: string;
  tenantId: string;
  customerId: string;
  modelName: string;
  licensePlate: string | null;
  inspectionExpiresOn: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Reservation = {
  id: string;
  tenantId: string;
  customerId: string;
  vehicleId: string;
  reservedAt: string;
  status: ReservationStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LineProfile = {
  id: string;
  tenantId: string;
  customerId: string | null;
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  followedAt: string | null;
  unfollowedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

## 5. 初期セットアップ手順

### 5.1 Next.js プロジェクト作成

```bash
npx create-next-app@latest . \
  --ts \
  --tailwind \
  --eslint \
  --app \
  --src-dir=false \
  --import-alias="@/*"
```

### 5.2 必要パッケージ

```bash
npm install @supabase/supabase-js @supabase/ssr zod date-fns clsx tailwind-merge lucide-react
npm install @line/bot-sdk
npm install -D supabase
```

カレンダー UI は初期実装では自前の月・週表示でも開始できます。ドラッグ操作や細かな日程管理が必要になった段階で `@fullcalendar/react` の導入を検討します。

### 5.3 環境変数

`.env.local` に以下を設定します。

```txt
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
NEXT_PUBLIC_LIFF_ID=

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 5.4 Supabase 初期化

```bash
npx supabase init
npx supabase db reset
```

ローカル Supabase を使わず、Hosted Supabase へ直接流す場合は Supabase SQL Editor で [supabase/schema.sql](../supabase/schema.sql) を実行します。

### 5.5 LINE 設定

1. LINE Developers で Messaging API チャネルを作成
2. Webhook URL に `https://{vercel-domain}/api/line/webhook` を設定
3. Webhook を有効化
4. LIFF アプリを作成
5. LIFF Endpoint URL に `https://{vercel-domain}/liff` を設定
6. `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`NEXT_PUBLIC_LIFF_ID` を Vercel 環境変数へ登録

### 5.6 Vercel 設定

1. GitHub リポジトリを Vercel に接続
2. Environment Variables を登録
3. Production / Preview の Supabase URL と LINE 設定を分ける
4. デプロイ後、LINE Webhook URL を Production URL に更新

## 6. 開発ロードマップ

### Phase 1: 基盤構築

- Next.js App Router 初期構築
- Tailwind CSS 設定
- Supabase client/server/admin helper 作成
- `.env.local.example` 作成
- DB schema 適用
- 型定義追加

### Phase 2: 管理画面の骨格

- SaaS 風 AppShell
- サイドバー、ヘッダー
- ダッシュボード
- 顧客一覧
- 車両一覧
- 予約一覧

### Phase 3: 予約カレンダー

- 月表示カレンダー
- 日別予約表示
- 同時間複数予約のセル表示
- 予約詳細モーダル
- ステータス変更
- 保存、削除

### Phase 4: 顧客・車両 CRUD

- 顧客作成、編集、削除
- 車両作成、編集、削除
- 顧客詳細に複数車両を表示
- 顧客と予約履歴の紐付け表示

### Phase 5: LINE Webhook

- Webhook 署名検証
- follow イベント受信
- LINE userId 保存
- displayName 取得
- `line_profiles` upsert

### Phase 6: LIFF 紐付け

- LIFF ログイン
- LINE userId 取得
- 電話番号や名前による既存顧客検索
- 顧客と LINE userId の紐付け
- LIFF 予約フォーム

### Phase 7: LINE 通知

- 予約受付メッセージ
- 予約確定メッセージ
- キャンセル通知
- 車検満了前リマインドの設計
- `notification_templates` と `notification_logs` の活用

### Phase 8: 多店舗化・権限

- Supabase Auth
- 管理者ユーザー
- tenant 切り替え
- RLS 有効化
- 店舗ごとのデータ分離

## 初期UI方針

- 白ベース、青アクセント、薄いグレーの境界線
- 角丸は控えめにし、Stripe / Notion 系の密度感に寄せる
- カードは情報単位に限定し、管理画面全体は広く使う
- カレンダーセルは同時間の予約が 2〜4 件入っても視認できるよう、予約チップを縦に並べる
- 詳細モーダルは 2 列グリッドで、顧客・車両・予約情報を分離
- スマホではサイドバーをドロワー化し、予約詳細は下からのモーダルに近い体験にする
