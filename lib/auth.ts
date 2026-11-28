import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "USER";
}

declare module "next-auth" {
  interface Session {
    user: SessionUser;
  }
}

const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
// HTTPS-only cookies are opt-in. The LAN server runs on plain http, where a Secure
// cookie is silently dropped by the browser and every login bounces back to /signin.
// Do not derive this from NODE_ENV or NEXTAUTH_URL; set AUTH_COOKIE_SECURE=true only
// once the app is actually served over https.
const secureCookies = process.env.AUTH_COOKIE_SECURE === "true";

// Google sign-in is allowlist only: the email must already exist in User and be active.
function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  // Errors (e.g. AccessDenied) come back to the sign-in page as ?error=...
  pages: { signIn: "/signin", error: "/signin" },
  cookies: {
    sessionToken: {
      name: `${secureCookies ? "__Secure-" : ""}laser-tender.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: secureCookies },
    },
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = (credentials?.email || "").trim().toLowerCase();
        const password = credentials?.password || "";
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role } as SessionUser;
      },
    }),
    ...(googleEnabled
      ? [
          GoogleProvider({
            clientId: process.env.AUTH_GOOGLE_ID!,
            clientSecret: process.env.AUTH_GOOGLE_SECRET!,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const email = profile?.email;
      if (!email || !(profile as { email_verified?: boolean }).email_verified) return false;
      const user = await findByEmail(email);
      return Boolean(user?.active);
    },
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "google") {
          // `user` is the Google profile here; swap in our own DB identity.
          const dbUser = user.email ? await findByEmail(user.email) : null;
          if (!dbUser?.active) return {};
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.email = dbUser.email;
          token.name = dbUser.name ?? user.name;
        } else {
          token.id = user.id;
          token.role = (user as SessionUser).role;
        }
        return token;
      }
      // Existing session: end it once the user is removed or deactivated.
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { active: true, role: true },
        });
        if (!dbUser?.active) return {};
        token.role = dbUser.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        id: token.id as string,
        email: token.email as string,
        name: token.name ?? null,
        role: token.role as SessionUser["role"],
      };
      return session;
    },
  },
};

export const isGoogleLoginEnabled = googleEnabled;

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? session.user : null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Sign in required");
  return user;
}
