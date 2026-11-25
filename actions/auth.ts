"use server";

import { prisma } from "@/lib/prisma";
import { hashPassword, parseSignUp, type SignUpInput } from "@/lib/password";

export async function signUp(input: SignUpInput): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = parseSignUp(input);
    if (!parsed.ok) return { success: false, error: parsed.error };
    const { name, email, password } = parsed.value;

    if (await prisma.user.findUnique({ where: { email } })) {
      return { success: false, error: "An account with this email already exists. Sign in instead." };
    }
    // shortcut: two sign-ups racing on an empty table could both become ADMIN; fix by hand if it ever happens.
    const role = (await prisma.user.count()) === 0 ? "ADMIN" : "USER";
    await prisma.user.create({ data: { name, email, passwordHash: await hashPassword(password), role } });
    return { success: true };
  } catch (err) {
    console.error("[SignUp] Error:", err);
    // P2002 = unique constraint: the same email was registered between the check and the insert.
    if ((err as { code?: string })?.code === "P2002") {
      return { success: false, error: "An account with this email already exists. Sign in instead." };
    }
    return { success: false, error: "Could not create the account. Please try again." };
  }
}
