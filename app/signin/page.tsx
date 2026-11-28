import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { isGoogleLoginEnabled } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  return (
    <AuthForm
      mode="signin"
      callbackUrl={typeof callbackUrl === "string" ? callbackUrl : undefined}
      authError={typeof error === "string" ? error : undefined}
      googleEnabled={isGoogleLoginEnabled}
    />
  );
}
