import { ResetPasswordForm } from "@/components/PasswordReset";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset password — HabitKnight" };

/* The token arrives in the URL fragment, which never reaches the server, so
   everything here happens in the browser. */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
