import type { Metadata } from "next";
import { Creator } from "../../components/creator";

export const metadata: Metadata = { title: "Create" };

export default function CreatePage() {
  return <Creator />;
}
