import type { Metadata } from "next";
import { AppRunner } from "../../components/app-runner";

export const metadata: Metadata = { title: "Swap" };

export default function SwapPage() {
  return <AppRunner />;
}
