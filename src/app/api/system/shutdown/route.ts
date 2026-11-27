import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { logAuditEvent, safeErrorResponse } from "@/lib/security";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const origin = req.headers.get("origin");
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
      return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
    }

    logAuditEvent(user.id, "system_shutdown", "User requested local server shutdown");

    // Allow the HTTP response to flush cleanly before terminating the local server
    setTimeout(() => {
      try {
        process.kill(process.pid, "SIGTERM");
      } catch {}
      setTimeout(() => {
        process.exit(0);
      }, 300);
    }, 200);

    return NextResponse.json({ ok: true, message: "Shutting down Ambo AI..." });
  } catch (err) {
    return safeErrorResponse(err, "Could not shut down server.");
  }
}
