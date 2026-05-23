import type { Metadata } from "next";
import { AdminDashboard } from "./admin-dashboard";

export const metadata: Metadata = {
  title: "予約管理 | Kawashima Motors Shaken",
};

export default function AdminPage() {
  return <AdminDashboard />;
}
