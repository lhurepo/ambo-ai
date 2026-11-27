import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { jobBus } from "@/lib/jobs/pipeline";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ensureDbInitialized();

  const { id } = await context.params;
  const sermon = db
    .select()
    .from(sermons)
    .where(and(eq(sermons.id, id), eq(sermons.userId, user.id)))
    .get();
  if (!sermon) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      // Send initial snapshot
      send({
        type: "status",
        status: sermon.status,
        progress: sermon.progress,
        progressMessage: sermon.progressMessage,
        errorMessage: sermon.errorMessage,
      });

      const listener = (payload: Record<string, unknown>) => {
        send(payload);
      };
      jobBus.on(`sermon:${id}`, listener);

      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {}
      }, 15000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(ping);
        jobBus.off(`sermon:${id}`, listener);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
