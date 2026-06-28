import { getLineConfig } from "@/lib/line/config";
import { pushLineTextMessage } from "@/lib/line/messaging";
import { supabaseServer } from "@/lib/supabase/server";

type ReservationCompletionNotificationInput = {
  customerId: string;
  vehicleId: string;
  reservationId: string;
  reservedAt: Date;
  vehicleModel: string;
  licensePlate: string | null;
};

const formatReservationDate = (value: Date) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(value);

const buildReservationCompletionMessage = (
  input: ReservationCompletionNotificationInput,
) => `ご予約ありがとうございます。

川島モータースです。

以下の内容でご予約を受け付けました。

━━━━━━━━━━━━━━

ご予約日時
${formatReservationDate(input.reservedAt)}

車種
${input.vehicleModel}

ナンバー
${input.licensePlate ?? "未登録"}

━━━━━━━━━━━━━━

内容を確認後、担当者よりご連絡いたします。

ご予約の変更・キャンセルをご希望の場合は、お電話にてご連絡ください。

電話番号
0268-81-2002

営業時間
8:00〜18:00
不定休

川島モータース`;

export async function sendReservationCompletionNotification(
  input: ReservationCompletionNotificationInput,
) {
  try {
    const { data: customer, error: customerError } = await supabaseServer
      .from("customers")
      .select("line_user_id,line_status")
      .eq("id", input.customerId)
      .maybeSingle();

    if (customerError) {
      throw new Error(`LINE連携情報の取得に失敗しました: ${customerError.message}`);
    }

    if (
      !customer?.line_user_id ||
      customer.line_status !== "連携済み"
    ) {
      return;
    }

    const body = buildReservationCompletionMessage(input);
    const accessToken = getLineConfig().channelAccessToken;
    let status: "成功" | "失敗" = "成功";
    let errorMessage: string | null = null;

    try {
      if (!accessToken) {
        throw new Error("LINE_CHANNEL_ACCESS_TOKEN が未設定です。");
      }
      await pushLineTextMessage(accessToken, customer.line_user_id, body);
    } catch (error) {
      status = "失敗";
      errorMessage =
        error instanceof Error ? error.message.slice(0, 1000) : "送信失敗";
      console.error("Failed to send reservation completion notification", error);
    }

    const { error: logError } = await supabaseServer
      .from("line_message_logs")
      .insert({
        customer_id: input.customerId,
        line_user_id: customer.line_user_id,
        target_type: "予約完了通知",
        title: "予約完了通知",
        body,
        status,
        error_message: errorMessage,
        sent_at: status === "成功" ? new Date().toISOString() : null,
        vehicle_id: input.vehicleId,
        reservation_id: input.reservationId,
        automation_type: "reservation_completion",
      });

    if (logError) {
      console.error(
        "Failed to save reservation completion notification log",
        logError.message,
      );
    }
  } catch (error) {
    console.error("Reservation completion notification failed", error);
  }
}
