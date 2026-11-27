# Ambo AI — Mac Setup Guide (Private 1-Click Local App)

Ambo AI runs strictly on `http://127.0.0.1:3000` (never exposed to your Wi-Fi or the internet) and uses your existing Claude Team / Pro subscription via `claude auth login`.

## 1. Three One-Time Terminal Commands (New Mac)

Open **Terminal** (`Cmd + Space` → type `Terminal` → Enter) and run:

```bash
# 1) Install Git, Node.js, FFmpeg, and Python
brew install git node ffmpeg python

# 2) Install the official Claude CLI
curl -fsSL https://claude.ai/install.sh | bash

# 3) Sign in to your Claude account once
claude auth login
```

> **Don't have Homebrew (`brew`) yet?** Install it first with:
> `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

*(Tip: For native `libass` subtitle rendering in Video Clip Studio, `brew install ffmpeg-full` is optional; standard `brew install ffmpeg` also works automatically.)*

## 2. Clone & Build the App (Recommended for 1-Click Updates)

```bash
git clone https://github.com/lhurepo/ambo-ai.git ~/ambo-ai
cd ~/ambo-ai
npm install
npm run build
```

*(If you unzipped `Ambo-AI-Mac.zip` instead of using `git clone`, double-clicking **`Start Ambo AI.command`** automatically runs `npm install`, sets up the Python worker, and runs `npm run build` on first launch.)*

## 3. Create a Desktop Alias (1-Click Launch)

1. Open your **`ambo-ai`** folder in **Finder** (`open ~/ambo-ai` in Terminal).
2. **First-time Gatekeeper open:** Right-click **`Start Ambo AI.command`** → **Open** → **Open**.
3. Right-click **`Start Ambo AI.command`** → click **Make Alias** → drag the alias to your **Desktop** and rename it **Ambo AI**.

## 4. Easy 1-Click Updates

- Inside the app, click **Update app** in the bottom-left sidebar and click **Update & restart now**.
- Or double-click **`Update Ambo AI.command`** in Finder.
- All local sermons, clips, prompts, and settings remain safe across updates.
