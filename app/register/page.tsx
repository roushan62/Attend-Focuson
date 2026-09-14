import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import RegisterForm from "@/components/RegisterForm";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getSession()) redirect("/");
  return <RegisterForm />;
}
