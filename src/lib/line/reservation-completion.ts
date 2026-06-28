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

const reservationCompletionAutomationType = "reservation_completion";
const defaultReservationCompletionSetting = {
  enabled: true,
  title: "予約完了通知",
  body: `ご予約ありがとうございます。

川島モータースです。

以下の内容でご予約を受け付けました。

━━━━━━━━━━━━━━

ご予約日時
{{reservation_datetime}}

車種
{{vehicle_name}}

ナンバー
{{plate_number}}

━━━━━━━━━━━━━━

内容を確認後、担当者よりご連絡いたします。

ご予約の変更・キャンセルをご希望の場合は、お電話にてご連絡ください。

電話番号
0268-81-2002

営業時間
8:00〜18:00
不定休

川島モータース`,
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

const renderReservationCompletionMessage = (
  template: string,
  input: ReservationCompletionNotificationInput,
  customerName: string,
) => {
  const values: Record<string, string> = {
    reservation_datetime: formatReservationDate(input.reservedAt),
    customer_name: customerName,
    vehicle_name: input.vehicleModel,
    plate_number: input.licensePlate ?? "未登録",
  };
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) =>
    key in values ? values[key] : `{{${key}}}`,
  );
};

export async function sendReservationCompletionNotification(
  input: ReservationCompletionNotificationInput,
) {
  try {
    const [customerResult, settingResult, successfulLogResult] =
      await Promise.all([
        supabaseServer
          .from("customers")
          .select("name,line_user_id,line_status")
          .eq("id", input.customerId)
          .maybeSingle(),
        supabaseServer
          .from("line_automation_settings")
          .select("enabled,title,body")
          .eq("automation_type", reservationCompletionAutomationType)
          .maybeSingle(),
        supabaseServer
          .from("line_message_logs")
          .select("id")
          .eq("automation_type", reservationCompletionAutomationType)
          .eq("reservation_id", input.reservationId)
          .eq("customer_id", input.customerId)
          .eq("status", "成功")
          .limit(1)
          .maybeSingle(),
      ]);

    const { data: customer, error: customerError } = customerResult;

    if (customerError) {
      throw new Error(`LINE連携情報の取得に失敗しました: ${customerError.message}`);
    }

    if (settingResult.error) {
      throw new Error(`予約完了通知設定の取得に失敗しました: ${settingResult.error.message}`);
    }
    if (successfulLogResult.error) {
      throw new Error(`予約完了通知履歴の確認に失敗しました: ${successfulLogResult.error.message}`);
    }

    const setting =
      settingResult.data ?? defaultReservationCompletionSetting;

    if (!setting.enabled || successfulLogResult.data) {
      return;
    }

    if (
      !customer?.line_user_id ||
      customer.line_status !== "連携済み"
    ) {
      return;
    }

    const body = renderReservationCompletionMessage(
      setting.body,
      input,
      customer.name,
    );
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
        title: setting.title,
        body,
        status,
        error_message: errorMessage,
        sent_at: status === "成功" ? new Date().toISOString() : null,
        vehicle_id: input.vehicleId,
        reservation_id: input.reservationId,
        automation_type: reservationCompletionAutomationType,
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
