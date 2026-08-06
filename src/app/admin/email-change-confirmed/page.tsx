import type { Metadata } from "next";
import { EmailChangeConfirmation } from "./email-change-confirmation";

export const metadata: Metadata = {
  title: "メールアドレスの確認 | Kawashima Motors Shaken",
};

export default function EmailChangeConfirmedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
      <EmailChangeConfirmation />
    </main>
  );
}
