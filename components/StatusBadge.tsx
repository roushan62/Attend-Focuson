import { statusMeta } from "@/lib/types";

export default function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status);
  return <span className={`chip ${m.cls}`}>{m.label}</span>;
}
