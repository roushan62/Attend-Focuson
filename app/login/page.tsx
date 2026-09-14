import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { driverName } from "@/lib/db";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return <LoginForm demo={driverName() === "local"} />;
}
