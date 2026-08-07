import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLinePushMessages } from "../src/lib/line/messaging.ts";
import {
  maxLineImageCount,
  resolveLineImageUrls,
} from "../src/lib/line/images.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const urls = Array.from(
  { length: maxLineImageCount },
  (_, index) => `https://example.com/image-${index + 1}.jpg`,
);

test("本文のみはtextメッセージ1件になる", () => {
  assert.deepEqual(buildLinePushMessages("本文", []), [
    { type: "text", text: "本文" },
  ]);
});

for (let count = 1; count <= maxLineImageCount; count += 1) {
  test(`画像${count}枚のみを選択順で送信する`, () => {
    const messages = buildLinePushMessages("", urls.slice(0, count));
    assert.equal(messages.length, count);
    assert.deepEqual(
      messages.map((message) => message.type),
      Array(count).fill("image"),
    );
    assert.deepEqual(
      messages.map((message) =>
        message.type === "image" ? message.originalContentUrl : "",
      ),
      urls.slice(0, count),
    );
  });

  test(`本文と画像${count}枚はtextの後に画像を選択順で送信する`, () => {
    const messages = buildLinePushMessages("本文", urls.slice(0, count));
    assert.equal(messages.length, count + 1);
    assert.deepEqual(messages.map((message) => message.type), [
      "text",
      ...Array(count).fill("image"),
    ]);
  });
}

test("本文と画像4枚のpayloadはtext、image 4件の計5件になる", () => {
  const messages = buildLinePushMessages("本文", urls);
  assert.equal(messages.length, 5);
  assert.deepEqual(messages.map((message) => message.type), [
    "text",
    "image",
    "image",
    "image",
    "image",
  ]);
});

test("既存1枚データはimage_urlから配列へフォールバックする", () => {
  assert.deepEqual(resolveLineImageUrls([], urls[0]), [urls[0]]);
  assert.deepEqual(resolveLineImageUrls(null, urls[0]), [urls[0]]);
  assert.deepEqual(resolveLineImageUrls(urls.slice(0, 2), urls[3]), urls.slice(0, 2));
});

test("Migrationは既存カラムを残してtext配列を追加・バックフィルする", async () => {
  const migration = await read(
    "supabase/migrations/202608070001_add_line_multiple_image_urls.sql",
  );
  assert.match(migration, /add column if not exists image_urls text\[\]/);
  assert.match(migration, /set image_urls = array\[image_url\]/);
  assert.match(migration, /cardinality\(image_urls\) <= 4/);
  assert.doesNotMatch(migration, /drop column/i);
});

test("即時・予約APIは旧imageと新imagesを受け、5枚目を拒否する", async () => {
  const [manualRoute, scheduledRoute] = await Promise.all([
    read("src/app/api/admin/line/send/route.ts"),
    read("src/app/api/admin/line/scheduled/route.ts"),
  ]);
  for (const source of [manualRoute, scheduledRoute]) {
    assert.match(source, /getAll\("images"\)/);
    assert.match(source, /formData\.get\("image"\)/);
    assert.match(source, /images\.length > maxLineImageCount/);
    assert.match(source, /添付画像は4枚まで選択できます/);
    assert.match(source, /uploadLineImages/);
  }
});

test("アップロード途中失敗時は送信前にアップロード済み画像を削除する", async () => {
  const distribution = await read("src/lib/line/distribution.ts");
  assert.match(distribution, /for \(const image of images\)/);
  assert.match(distribution, /await removeLineImages\(uploadedUrls\)/);
  assert.match(distribution, /buildLinePushMessages\(messageBody, input\.imageUrls\)/);
});

test("共通UIは追加・削除・差し替えとPC4列・スマホ2列に対応する", async () => {
  const [dropzone, hook] = await Promise.all([
    read("src/app/admin/line/line-image-dropzone.tsx"),
    read("src/app/admin/line/use-line-image-attachments.ts"),
  ]);
  assert.match(dropzone, /multiple/);
  assert.match(dropzone, /grid-cols-2 gap-3 sm:grid-cols-4/);
  assert.match(dropzone, /onReplaceFile/);
  assert.match(dropzone, /onRemove\(index\)/);
  assert.match(hook, /attachments\.length \+ files\.length > maxLineImageCount/);
  assert.match(hook, /current\.filter/);
  assert.match(hook, /current\.map/);
});

test("予約配信・履歴はimage_urlsを優先し旧image_urlも表示する", async () => {
  const [scheduled, history, customerHistory] = await Promise.all([
    read("src/lib/line/scheduled.ts"),
    read("src/app/admin/line/line-distribution.tsx"),
    read("src/app/admin/customers/[id]/customer-detail.tsx"),
  ]);
  assert.match(scheduled, /resolveLineImageUrls\(message\.image_urls, message\.image_url\)/);
  assert.match(history, /resolveLineImageUrls\(log\.image_urls, log\.image_url\)/);
  assert.match(customerHistory, /resolveLineImageUrls\(log\.imageUrls, log\.imageUrl\)/);
});
