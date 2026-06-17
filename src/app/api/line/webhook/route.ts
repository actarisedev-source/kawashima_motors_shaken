import { NextResponse } from "next/server";
import { getLineConfig } from "@/lib/line/config";
import { verifyLineWebhookSignature } from "@/lib/line/signature";
import type { LineWebhookPayload } from "@/types/line";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { channelSecret } = getLineConfig();

  if (!channelSecret) {
    return NextResponse.json(
      {
        ok: false,
        message: "LINE webhook is not configured.",
      },
      { status: 503 },
    );
  }

  const signature = request.headers.get("x-line-signature");
  const rawBody = await request.text();

  if (
    !signature ||
    !verifyLineWebhookSignature(rawBody, signature, channelSecret)
  ) {
    return NextResponse.json(
      { ok: false, message: "Invalid LINE webhook signature." },
      { status: 401 },
    );
  }

  let payload: LineWebhookPayload;

  try {
    payload = JSON.parse(rawBody) as LineWebhookPayload;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid webhook payload." },
      { status: 400 },
    );
  }

  if (!Array.isArray(payload.events)) {
    return NextResponse.json(
      { ok: false, message: "Webhook events must be an array." },
      { status: 400 },
    );
  }

  // Event-specific persistence and replies will be added in later phases.
  return NextResponse.json({ ok: true });
}
