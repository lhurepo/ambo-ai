import type { ExportMode } from "./types";

export interface ExportPreferences {
  exportMode: ExportMode;
  pdfExportDir: string;
  mediaExportDir: string;
}

export async function fetchExportPreferences(): Promise<ExportPreferences> {
  try {
    const res = await fetch("/api/settings/ai", { cache: "no-store" });
    if (!res.ok) {
      return { exportMode: "browser", pdfExportDir: "", mediaExportDir: "" };
    }
    const d = await res.json();
    return {
      exportMode: (d?.settings?.exportMode as ExportMode) || "browser",
      pdfExportDir: d?.settings?.pdfExportDir || "",
      mediaExportDir: d?.settings?.mediaExportDir || "",
    };
  } catch {
    return { exportMode: "browser", pdfExportDir: "", mediaExportDir: "" };
  }
}

export async function revealPathInFinder(targetPath: string): Promise<void> {
  try {
    await fetch("/api/system/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal", path: targetPath }),
    });
  } catch {}
}

export async function saveBlobWithMode(params: {
  blob: Blob;
  fileName: string;
  mimeType: string;
  exportMode: ExportMode;
}): Promise<void> {
  const { blob, fileName, mimeType, exportMode } = params;

  if (
    exportMode === "ask" &&
    typeof window !== "undefined" &&
    "showSaveFilePicker" in window
  ) {
    try {
      const picker = (
        window as unknown as {
          showSaveFilePicker: (opts: {
            suggestedName: string;
            types?: Array<{ accept: Record<string, string[]> }>;
          }) => Promise<{
            createWritable: () => Promise<{
              write: (data: Blob) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }>;
        }
      ).showSaveFilePicker;
      const ext = fileName.includes(".") ? "." + fileName.split(".").pop() : ".bin";
      const handle = await picker({
        suggestedName: fileName,
        types: [{ accept: { [mimeType]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // User cancelled the Save As dialog — exit silently with no toast
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      // Fall through to standard browser download if picker unsupported/blocked
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadMediaEndpoint(params: {
  endpointUrl: string;
  fileName: string;
  mimeType: string;
  onSavedToFolder?: (info: { savedPath: string; displayPath: string; fileName: string }) => void;
}): Promise<void> {
  const { endpointUrl, fileName, mimeType, onSavedToFolder } = params;
  const prefs = await fetchExportPreferences();

  if (prefs.exportMode === "folder" && prefs.mediaExportDir) {
    const sep = endpointUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${endpointUrl}${sep}saveToDisk=1`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Could not save file to folder.");
    }
    onSavedToFolder?.({
      savedPath: data.savedPath,
      displayPath: data.displayPath,
      fileName: data.fileName || fileName,
    });
    return;
  }

  if (prefs.exportMode === "ask" && typeof window !== "undefined" && "showSaveFilePicker" in window) {
    const res = await fetch(endpointUrl);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || "Download failed.");
    }
    const blob = await res.blob();
    await saveBlobWithMode({ blob, fileName, mimeType, exportMode: "ask" });
    return;
  }

  const a = document.createElement("a");
  a.href = endpointUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
