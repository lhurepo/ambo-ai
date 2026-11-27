import { NextResponse } from "next/server";
import archiver from "archiver";
import fs from "fs";
import { PassThrough } from "stream";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermonAssets, sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { renderClipMp4 } from "@/lib/jobs/pipeline";

export async function GET(
  _req: Request,
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

  const clipList = db.select().from(clips).where(eq(clips.sermonId, id)).all();
  const assetsList = db.select().from(sermonAssets).where(eq(sermonAssets.sermonId, id)).all();

  // Render any pending clips first
  for (const c of clipList) {
    if (!c.renderedPath || !fs.existsSync(c.renderedPath) || c.renderStatus !== "completed") {
      try {
        const rendered = await renderClipMp4(c.id);
        c.renderedPath = rendered;
      } catch (err) {
        console.warn("Skip failed clip in zip:", c.id, err);
      }
    }
  }

  const pass = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(pass);

  for (const c of clipList) {
    if (c.renderedPath && fs.existsSync(c.renderedPath)) {
      const safe = c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || c.id;
      archive.file(c.renderedPath, { name: `clips/${safe}.mp4` });
    }
  }

  // Include all generated written resources as clean Markdown
  const mdParts = [`# ${sermon.title}\n\nTopic: ${sermon.topic}\n`];
  for (const a of assetsList) {
    mdParts.push(`\n---\n\n### ${a.assetType.replace(/_/g, " ").toUpperCase()}\n\n${a.content}\n`);
  }
  if (sermon.transcriptText) {
    mdParts.push(`\n---\n\n### FULL TRANSCRIPT\n\n${sermon.transcriptText}\n`);
  }
  archive.append(mdParts.join("\n"), { name: "sermon-resources.md" });
  archive.finalize();

  const webStream = new ReadableStream({
    start(controller) {
      pass.on("data", (chunk) => controller.enqueue(chunk));
      pass.on("end", () => controller.close());
      pass.on("error", (err) => controller.error(err));
    },
    cancel() {
      pass.destroy();
    },
  });

  const slug = sermon.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "sermon-pack";
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}-ambo-pack.zip"`,
    },
  });
}
