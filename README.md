# Ambo AI — The Garden Church Edition

**Turn one sermon into church-branded PDFs, study guides, vertical video clips, and podcast MP3s — 100% free & private on your Mac.**

Ambo AI runs strictly on your own computer (`http://127.0.0.1:3000`, never exposed to Wi-Fi or the internet), transcribes audio/video locally with `faster-whisper`, renders 9:16 vertical clips with FFmpeg, and uses your existing Claude Team / Pro subscription via `claude auth login` (or free Gemini / Ollama / built-in offline engine).

---

## Easy Mac Setup (3 Steps)

### Step 1: One-Time Tools Setup
Open **Terminal** (`Cmd + Space` → type `Terminal` → press **Return**) and run:

1. **Install Homebrew** (skip if `brew --version` already works):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   *(If Homebrew asks you to run two `echo` / `eval` commands at the end on Apple Silicon, copy and run those too.)*

2. **Install Git, Node.js, FFmpeg, and Python**:
   ```bash
   brew install git node ffmpeg python
   ```

3. **Install & Sign In to Claude CLI** (uses your existing Claude subscription, no API key needed):
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   claude auth login
   ```

---

### Step 2: Download & Build Ambo AI
In Terminal, run:

```bash
git clone https://github.com/lhurepo/ambo-ai.git ~/ambo-ai
cd ~/ambo-ai
npm install
npm run build
open .
```

*(Optional: to set up the Python transcription worker right away instead of waiting for first launch, also run `python3 -m venv python-worker/.venv && python-worker/.venv/bin/pip install -r python-worker/requirements.txt`.)*

---

### Step 3: Create a 1-Click Desktop Shortcut
1. In the **Finder** window that just opened, find **`Start Ambo AI.command`**.
2. **First time only (macOS security prompt):** Right-click **`Start Ambo AI.command`** → click **Open** → click **Open**.
3. Right-click **`Start Ambo AI.command`** → click **Make Alias** → drag the alias onto your **Desktop** (you can rename it to **Ambo AI**).

From now on, just **double-click Ambo AI on your Desktop** — it starts privately in the background and opens in your browser. When you're done, click **Shut down app** in the bottom-left sidebar to stop it completely.

---

## Easy 1-Click Updates
Whenever new features or fixes are pushed to GitHub:

- **Inside Ambo AI:** Click **Update app** in the bottom-left sidebar, then click **Update & restart now**.
- **Or from Finder:** Double-click **`Update Ambo AI.command`** in your `~/ambo-ai` folder.

Your sermons, clips, custom prompts, and settings are stored locally in `data/` and stay untouched during every update.

---

## Key Features
- **Sermon Workspace:** Upload MP4/MOV/MP3, paste a YouTube link, or upload a manuscript (`TXT`, `MD`, `PDF`, `DOCX`, `PPTX`).
- **Garden Church PDF Packet:** Branded PDFs using official Garden Church **Yankee** fonts with one-click single-resource export or full multi-section packets with reflection lines.
- **9:16 Video Clip Studio:** Auto-curated sermon moments, speaker tracking, live caption preview, word-level transcript editing, and MP4 / `.zip` export.
- **Spotify MP3 Export:** One-click 192kbps stereo MP3 audio export from any sermon video.
- **Custom Generation Rules (`/prompt-library`):** Customize the AI instructions used automatically on every sermon.
