# Smart Reader

Smart Reader is a local ebook reader for Mac, built for non-fiction. Read EPUBs and PDFs, highlight what matters, and your highlights become spaced-repetition cards you review daily. A side terminal lets you talk to an AI coach (Claude Code, Codex or Gemini) that works on your notes. Everything stays on your Mac: nothing is uploaded anywhere.

## Install

Requires macOS 13 or later.

```bash
curl -fsSL https://raw.githubusercontent.com/spencertse122/mac-smart-reader/main/install.sh | bash
```

The installer uses the GitHub CLI (`gh`) when it is installed and logged in, and plain `curl` otherwise.

If the repository is ever made private, the command above stops working. Log in with the GitHub CLI first and fetch the installer through it:

```bash
brew install gh && gh auth login     # once
gh api repos/spencertse122/mac-smart-reader/contents/install.sh --jq .content | base64 -d | bash
```

Running the same command again updates the app to the latest release.

The app is not signed with a paid Apple Developer ID, so macOS would normally refuse to open it. The installer clears the quarantine flag (`xattr -dr com.apple.quarantine`) on the installed app so it opens normally.

**Manual install:** download the DMG for your Mac (`arm64` for Apple Silicon, `x64` for Intel) from the [Releases page](https://github.com/spencertse122/mac-smart-reader/releases), drag Smart Reader to Applications, then run:

```bash
xattr -dr com.apple.quarantine "/Applications/Smart Reader.app"
```

## First run

Choose the folder that holds your books. Smart Reader creates these inside it:

- `.smartreader/` for the app's own data (highlights, cards, stats)
- `knowledge/` for notes the AI coach writes
- coach skills, plus `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` instructions for each agent

Your books are never modified or uploaded.

## Daily use

- **Highlight:** select text, then pick a color.
- **Review:** open the review view, press Space to reveal, then 1 to 4 to grade (Again, Hard, Good, Easy).
- **Pomodoro:** Option+Command+P starts or pauses a focus timer.
- **Terminal:** Command+J toggles the side terminal.
- **Stats:** see your reading and review streaks in the stats view.

## AI coach

Install one agent CLI:

```bash
npm install -g @anthropic-ai/claude-code   # Claude Code
npm install -g @openai/codex               # Codex
npm install -g @google/gemini-cli          # Gemini
```

Open the terminal (Command+J), start the agent, and try:

- "distill my new highlights"
- "recall chapter 3"
- "drill my weak spots"
- "what do I know about incentives?"
- "weekly review"

## Your data and backups

Everything is plain files in your books folder. Back it up with Time Machine or similar. It is not stored in GitHub.

## Development

```bash
npm install
npm run dev
npm test
xvfb-run -a npm run e2e   # Linux
npm run e2e               # macOS
npm run dist:mac          # macOS only
```

To release: bump `version` in `package.json`, then `git tag vX.Y.Z && git push --tags`. The release workflow builds both DMGs and attaches them to the GitHub Release.
