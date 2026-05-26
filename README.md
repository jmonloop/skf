# skf — fuzzy skill finder

Find that AI-agent skill you *know* exists but can't remember the name of.

Most skills are manually invoked (`disable-model-invocation: true`), and the
built-in slash menus only fuzzy-match skill **names** — not their descriptions.
So if you remember *what a skill does* but not its exact name, you're stuck.

`skf` fuzzy-searches across **name + description** of every `SKILL.md` it can
find, previews the match, and prints (and copies) the invocation token so you
can paste it straight into your agent.

It is **read-only** — it never touches a `SKILL.md`, so manual invocation keeps
working exactly as before.

## Agent-agnostic

`SKILL.md` is a shared convention. `skf` scans the skill directories of multiple
agents and dedups by name (newest version wins):

| Agent       | Scanned roots                                   |
|-------------|-------------------------------------------------|
| Claude Code | `~/.claude` (incl. `plugins/cache`)             |
| Codex       | `~/.codex`                                       |
| OpenCode    | `~/.config/opencode`, `~/.opencode`             |
| Pi          | `~/.pi`, `~/.config/pi`                          |
| Project     | `<git-root>/{.claude,.codex,.opencode,.pi,.skills}` |
| Custom      | anything in `$SKF_PATHS`                         |

Roots are scanned in priority order: **custom → project → global**.

## Install

```bash
git clone https://github.com/jmonloop/skf.git
cd skf
./install.sh            # symlinks ./skf into ~/.local/bin
# or: ./install.sh /usr/local/bin
```

Requires **bash**, **fzf** (interactive mode), and **awk**. Clipboard copy is
optional and auto-detected: `pbcopy` / `xclip` / `xsel` / `wl-copy` / `clip.exe`.

## Usage

```bash
skf                 # interactive picker: type to filter name+description
skf opsctrl         # picker pre-seeded with a query
skf -p "local test" # print mode (no UI): list "/name — desc" matches
skf -p              # print mode: list every skill
skf -h              # help
```

- **Interactive:** `ENTER` prints `/<name>` and copies it to the clipboard.
  Paste it into your agent.
- **Print mode** needs no TTY, so inside a Claude Code / agent TUI you can run
  `! skf -p auth` and the matches land right in the conversation.

## Config

| Env var      | Default | Purpose                                            |
|--------------|---------|----------------------------------------------------|
| `SKF_PATHS`  | —       | Colon-separated extra roots to scan (highest priority). |
| `SKF_PREFIX` | `/`     | Invocation prefix printed/copied (set `""` for none, or e.g. `@`). |

```bash
SKF_PATHS="$HOME/work/.claude:/opt/shared/skills" skf
SKF_PREFIX="" skf -p deploy        # print bare skill names
```

## How it works

1. Collect every `SKILL.md` under the configured roots (pruning `node_modules`
   and `.git`), newest version first.
2. Parse YAML frontmatter `name` + `description` (handles folded/literal block
   scalars), dedup by name.
3. Fuzzy-search name+description with `fzf`; preview the file; emit the token.

## License

MIT
