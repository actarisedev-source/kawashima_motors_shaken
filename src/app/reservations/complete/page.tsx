import type { Metadata } from "next";
import { ReservationCompletePage } from "./reservation-complete-page";

export const metadata: Metadata = {
  title: "予約完了 | Kawashima Motors Shaken",
};

export default function CompletePage() {
  return <ReservationCompletePage />;
}
