import type { Metadata } from "next";
import { ReservationConfirmation } from "./reservation-confirmation";

export const metadata: Metadata = {
  title: "予約確認 | Kawashima Motors Shaken",
};

export default async function ReservationConfirmationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <ReservationConfirmation token={token} />;
}
