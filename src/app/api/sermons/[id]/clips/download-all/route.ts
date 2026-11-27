import { NextResponse } from "next/server";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermonAssets, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { copyFileToExportDir } from "@/lib/local-export";
import { renderClipMp4 } from "@/lib/jobs/pipeline";
import { safeErrorResponse } from "@/lib/security";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
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

    const mdParts = [`# ${sermon.title}\n\nTopic: ${sermon.topic}\n`];
    for (const a of assetsList) {
      mdParts.push(`\n---\n\n### ${a.assetType.replace(/_/g, " ").toUpperCase()}\n\n${a.content}\n`);
    }
    if (sermon.transcriptText) {
      mdParts.push(`\n---\n\n### FULL TRANSCRIPT\n\n${sermon.transcriptText}\n`);
    }

    const slug =
      sermon.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "sermon-pack";
    const zipName = `${slug}-ambo-pack.zip`;

    const { searchParams } = new URL(req.url);
    if (searchParams.get("saveToDisk") === "1") {
      const settings = ensureUserAiSettings(user.id);
      if (!settings.mediaExportDir) {
        return NextResponse.json(
          { error: "No Video & Audio folder configured in Settings." },
          { status: 400 }
        );
      }
      const tmpDir = path.join(process.cwd(), "data", "renders", id);
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpZip = path.join(tmpDir, `${slug}-tmp.zip`);
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(tmpZip);
        const archive = archiver("zip", { zlib: { level: 6 } });
        out.on("close", () => resolve());
        out.on("error", reject);
        archive.on("error", reject);
        archive.pipe(out);
        for (const c of clipList) {
          if (c.renderedPath && fs.existsSync(c.renderedPath)) {
            const safe =
              c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || c.id;
            archive.file(c.renderedPath, { name: `clips/${safe}.mp4` });
          }
        }
        archive.append(mdParts.join("\n"), { name: "sermon-resources.md" });
        archive.finalize();
      });
      const saved = copyFileToExportDir(settings.mediaExportDir, zipName, tmpZip);
      fs.rmSync(tmpZip, { force: true });
      return NextResponse.json({ ok: true, ...saved });
    }

    const pass = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.pipe(pass);

    for (const c of clipList) {
      if (c.renderedPath && fs.existsSync(c.renderedPath)) {
        const safe =
          c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || c.id;
        archive.file(c.renderedPath, { name: `clips/${safe}.mp4` });
      }
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

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not build export pack.");
  }
}
