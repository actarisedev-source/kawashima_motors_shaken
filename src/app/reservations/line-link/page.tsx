import type { Metadata } from "next";
import { LineLinkForm } from "./line-link-form";

export const metadata: Metadata = {
  title: "LINE連携 | Kawashima Motors Shaken",
};

export default function LineLinkPage() {
  return (
    <LineLinkForm liffId={process.env.NEXT_PUBLIC_LIFF_ID?.trim() ?? ""} />
  );
}
