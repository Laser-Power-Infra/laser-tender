import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_PASSWORD = "Laser@2026";

const getWorkerKey = (): string | null => {
  const key = (process.env.WORKER_API_KEY || "").trim().replace(/^"|"$/g, "");
  return key || null;
};

const extractAuthKey = (req: Request): string | null => {
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  return req.headers.get("x-api-key")?.trim() || null;
};

// Allowed for a signed-in ADMIN, or with WORKER_API_KEY (for when no admin can sign in).
async function authorize(req: Request): Promise<string | null> {
  const expected = getWorkerKey();
  const provided = extractAuthKey(req);
  if (expected && provided && provided === expected) return "api-key";
  const user = await getSessionUser();
  if (user?.role === "ADMIN") return user.email;
  return null;
}

export async function POST(request: Request) {
  const actor = await authorize(request);
  if (!actor) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let email = "";
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim().toLowerCase();
  } catch {
    // fall through to the validation below
  }
  if (!email) {
    return NextResponse.json({ success: false, error: "email is required" }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ success: false, error: "No user with that email" }, { status: 404 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(DEFAULT_PASSWORD) },
    });
    console.log(`[ResetPassword] ${email} reset to default by ${actor}`);
    return NextResponse.json({ success: true, email });
  } catch (err) {
    console.error("[ResetPassword] Error:", err);
    return NextResponse.json({ success: false, error: "Could not reset the password" }, { status: 500 });
  }
}
