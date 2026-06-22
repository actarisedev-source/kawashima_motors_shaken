import type { LineAudienceFilters } from "@/lib/line/audience";
import { sendLineDistribution } from "@/lib/line/distribution";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

type ScheduledMessage =
  Database["public"]["Tables"]["line_scheduled_messages"]["Row"];

const parseFilters = (value: Json): LineAudienceFilters => {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  const filters = value as Record<string, Json | undefined>;
  const stringArray = (key: string) =>
    Array.isArray(filters[key])
      ? filters[key].filter((item): item is string => typeof item === "string")
      : [];
  return {
    shaken: stringArray("shaken"),
    visits: stringArray("visits"),
    genders: stringArray("genders"),
    ages: stringArray("ages"),
    customerIds: stringArray("customerIds"),
  };
};

async function finishScheduledMessage(
  message: ScheduledMessage,
  update: Database["public"]["Tables"]["line_scheduled_messages"]["Update"],
) {
  const { error } = await supabaseServer
    .from("line_scheduled_messages")
    .update({
      ...update,
      processing_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", message.id);
  if (error) throw new Error(error.message);
}

export async function processDueScheduledMessages(
  accessToken: string,
  limit = 20,
) {
  const { data, error } = await supabaseServer.rpc(
    "claim_due_line_scheduled_messages",
    { p_limit: limit },
  );
  if (error) throw new Error(error.message);

  const results = [];
  for (const message of data ?? []) {
    try {
      const result = await sendLineDistribution({
        accessToken,
        title: message.title,
        messageBody: message.body,
        imageUrl: message.image_url,
        targetLabel: message.target_label,
        targetTypePrefix: "予約配信",
        filters: parseFilters(message.target_conditions),
      });
      const failed = result.failureCount > 0 || result.logFailureCount > 0;
      const finishedAt = new Date().toISOString();
      const errorMessage = failed
        ? `送信失敗 ${result.failureCount}件 / ログ保存失敗 ${result.logFailureCount}件`
        : null;
      await finishScheduledMessage(message, {
        status: failed ? "失敗" : "送信済み",
        error_message: errorMessage,
        sent_at: result.successCount > 0 ? finishedAt : null,
      });
      results.push({ id: message.id, ok: !failed, ...result, errorMessage });
    } catch (executionError) {
      const errorMessage =
        executionError instanceof Error
          ? executionError.message.slice(0, 1000)
          : "予約配信に失敗しました。";
      await finishScheduledMessage(message, {
        status: "失敗",
        error_message: errorMessage,
        sent_at: null,
      });
      results.push({ id: message.id, ok: false, errorMessage });
    }
  }

  return { claimedCount: data?.length ?? 0, results };
}
