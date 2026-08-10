import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifySession } from "@/lib/session";
import { PRIVACY_VERSION } from "@/lib/policy";

/* --------------------------------------------------------------------------
   The auth gate, and the Content-Security-Policy.

   The CSP is not decoration here — it is what the encryption rests on. The
   unwrapped private key lives in sessionStorage so that navigating between
   pages doesn't re-prompt for a password, which means *any* script that runs
   on this origin can read it and decrypt every message the account has. No
   amount of ECDH helps once an attacker can execute JavaScript in the page.
   So the policy is nonce-based: Next's own inline bootstrap scripts carry a
   per-request nonce, and an injected <script> without one simply never runs.
   -------------------------------------------------------------------------- */

const PUBLIC_PATHS = ["/login", "/privacy"];

function policy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced bootstrap load the chunks it needs
    // without every chunk URL having to be listed. Dev additionally needs
    // 'unsafe-eval' for React Refresh; production must never have it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${dev ? "'unsafe-eval'" : ""}`.trim(),
    // Motion writes inline styles as it animates, so this one can't be nonced.
    // Injected CSS is a far smaller problem than injected script.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Server actions post back to this origin; nothing should reach anywhere
    // else. This is also what stops an injected script exfiltrating messages.
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const dev = process.env.NODE_ENV !== "production";
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = policy(nonce, dev);

  // Next reads the nonce back out of this request header to stamp its own
  // inline scripts, so the two can never drift apart.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const harden = (res: NextResponse) => {
    res.headers.set("content-security-policy", csp);
    res.headers.set("x-content-type-options", "nosniff");
    res.headers.set("referrer-policy", "no-referrer");
    res.headers.set("x-frame-options", "DENY");
    res.headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
    );
    if (!dev) {
      res.headers.set(
        "strict-transport-security",
        "max-age=63072000; includeSubDomains; preload"
      );
    }
    return res;
  };

  // Without a secret there is no session to verify; let the login page render
  // its own setup instructions rather than redirect-looping.
  if (!process.env.SESSION_SECRET) {
    return harden(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  const session = await verifySession(request.cookies.get(COOKIE)?.value);
  const userId = session?.userId ?? null;
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  /* The consent gate. It lives here rather than in each page because this is
     the one place every request passes through — a page-by-page check is a
     list someone will forget to add to. The accepted version rides in the
     signed cookie, so this costs no database read and can't be edited around. */
  if (
    session &&
    session.privacyVersion < PRIVACY_VERSION &&
    pathname !== "/consent" &&
    !isPublic
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/consent";
    url.search = "";
    return harden(NextResponse.redirect(url));
  }

  // Already agreed? Then the gate has nothing to say.
  if (session && session.privacyVersion >= PRIVACY_VERSION && pathname === "/consent") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return harden(NextResponse.redirect(url));
  }

  if (!userId && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Only the path, never the query string: it can carry anything and gets
    // reflected back into the login page.
    url.searchParams.set("next", pathname);
    return harden(NextResponse.redirect(url));
  }

  if (userId && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return harden(NextResponse.redirect(url));
  }

  return harden(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
