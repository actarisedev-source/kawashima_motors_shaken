import { NextResponse } from "next/server";
import {
  createReservation,
  type ReservationCreateRequest,
} from "@/lib/reservations/create-reservation";

export async function POST(request: Request) {
  const body = (await request.json()) as ReservationCreateRequest;
  const result = await createReservation({
    body,
    mode: "public",
    requestUrl: request.url,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.message },
      { status: result.statusCode },
    );
  }

  return NextResponse.json({
    ok: true,
    reservationId: result.reservationId,
    status: result.reservationStatus,
    confirmationUrl: result.confirmationUrl,
    lineLinkWarning: result.lineLinkWarning,
    lineLinked: result.lineLinked,
  });
}
