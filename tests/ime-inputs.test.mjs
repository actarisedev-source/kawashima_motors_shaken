import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isImeCompositionActive } from "../src/lib/forms/ime.ts";
import { normalizePhone } from "../src/lib/customers/phone.ts";

const reservationForm = readFileSync(
  new URL("../src/app/reservation-form.tsx", import.meta.url),
  "utf8",
);
const customerDetail = readFileSync(
  new URL(
    "../src/app/admin/customers/[id]/customer-detail.tsx",
    import.meta.url,
  ),
  "utf8",
);
const lineEmojiPicker = readFileSync(
  new URL("../src/app/admin/line/line-emoji-picker.tsx", import.meta.url),
  "utf8",
);

test("IME変換中を追跡フラグ・native event・keyCode 229から判定する", () => {
  assert.equal(isImeCompositionActive(true), true);
  assert.equal(
    isImeCompositionActive(false, { isComposing: true }),
    true,
  );
  assert.equal(isImeCompositionActive(false, { keyCode: 229 }), true);
  assert.equal(isImeCompositionActive(false, { isComposing: false }), false);
});

test("公開予約フォームはIME確定まで電話番号の正規化とふりがな検証を待つ", () => {
  assert.match(reservationForm, /customerKanaComposingRef/);
  assert.match(reservationForm, /phoneComposingRef/);
  assert.match(reservationForm, /onCompositionStart/);
  assert.match(reservationForm, /onCompositionEnd/);
  assert.match(reservationForm, /\? nextValue\s*: normalizePhone\(nextValue\)/);
  assert.match(reservationForm, /const normalizedPhone = normalizePhone\(phone\)/);
});

test("顧客編集とLINE本文はcomposition中の追加処理を抑止する", () => {
  assert.match(customerDetail, /customerKanaComposingRef/);
  assert.match(customerDetail, /isImeCompositionActive/);
  assert.match(lineEmojiPicker, /isTextareaComposingRef/);
  assert.match(lineEmojiPicker, /onCompositionEnd/);
  assert.match(lineEmojiPicker, /isImeCompositionActive/);
});

test("電話番号の保存時正規化は従来どおり維持する", () => {
  assert.equal(normalizePhone("０９０ー１２３４ー５６７８"), "09012345678");
  assert.equal(normalizePhone(" 090-1234-5678 "), "09012345678");
});
