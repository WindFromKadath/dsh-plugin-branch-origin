# dsh-plugin-branch-origin · Branch origin (DSH plugin)

[English](README.md) | [简体中文](README.zh-CN.md)

> Labels every forked session with where it came from, so that "which conversation was this split from?" is visible directly in the sidebar.

**Two channels, complementary**:

| Channel | Shape | After a rename |
|---|---|---|
| Host half (title) | The child session title becomes `⤷ 来源：<source session title>` | **Lost** — the label is part of the title string |
| Client half (sidebar badge) | A `⤷` at the start of the row (hover shows the source title) | **Still shown** — it reads the session's parent field and never touches the title |

Zero dependencies, no build chain. The host half is [lib/index.js](lib/index.js) plus one line in [cordis.patch.yml](cordis.patch.yml); the client half is the hand-written [lib/client.js](lib/client.js) and uses only the base `react` / `react/jsx-runtime`.

`⤷ 来源：` is a fixed product string (literally “source:”); it is not translated, so titles stay recognizable across locales.

## Why it is needed

DSH forks **already** record a real parent-child link and **already** expose some visibility, but nothing states which conversation a fork came from:

| Already provided by DSH | The missing cell |
|---|---|
| `SessionHeader.parentSession` (the real parent link) | The sidebar does not show what it points to |
| The official fork renames the child to `<source title> (1)` (`increasedForkTitle`) | A counter alone does not say this is someone's fork |
| The sidebar indents by `SessionListEntry.depth` | Indentation does not name the source conversation |

This plugin fills that cell, **twice**: it rewrites the child title to `⤷ 来源：<source title>` (the origin is stated in the title itself), and it adds a source badge on the sidebar row that does not depend on the title (so a rename cannot erase it).

## Behavior

There is one rule; everything else follows from it.

| Case | Result |
|---|---|
| A new fork from any entry point (sidebar “fork session”, message menu, another plugin's fork, `ctx.sessions.fork`) | The title becomes `⤷ 来源：<source title>` |
| DSH then renames it to `<source title> (1)` | It converges to `⤷ 来源：<source title> (1)`; the counter is kept so several forks of one source stay distinguishable |
| The child title was already changed by the user or another lineage plugin (for example `⑂1 …`, `my experiment`) | **Left alone** (label only, never take over) |
| The child title already starts with `⤷ 来源：` | Idempotent; not written twice |
| A normal new session with no parent | Left alone |
| A subagent session (`header.origin === 'subagent'`) | Left alone by default; enable with `labelSubagents` |
| The source session had no title at that moment | Left alone |

Judgment detail: the marker is only applied when the child title, **with the official trailing counter removed, equals the source title** — that is the test for “still inherited”. See [docs/DESIGN.md](docs/DESIGN.md).

### Sidebar badge (client half)

Read-only; the official row is never replaced:

| Case | Result |
|---|---|
| The row has a non-empty parent field and is not a subagent session | A `⤷` appears at the start of the row, and hovering the row shows a “来源” section with the source conversation title |
| You **rename** that session | The badge **stays** (it does not read the title), while the `⤷ 来源：…` inside the title disappears with the rename |
| The source conversation is renamed | The badge shows the **new** name (read live from the list); the copy inside the title is a snapshot taken at fork time and does not change |
| The source conversation is absent from the current list snapshot | It shows `（未命名对话）` and does not crash |
| Normal session / subagent session / subagent fork | No badge |

## Install and enable

**Installed into the `desktop` profile** (2026-10-07), in the same shape as `dsh-plugin-branch`, which was verified on `trial`:

| Landing spot | Content |
|---|---|
| `<profile>/package.json` → `dependencies` | `"dsh-plugin-branch-origin": "link:<this repository>"` (the plugin page's “installed” list reads this) |
| Same file → `dsh.profile.bundles` | The package name is appended (the enable switch in the UI; composition applies this bundle's patch from it) |
| `<profile>/node_modules/dsh-plugin-branch-origin` | A directory link pointing at this repository |

One script installs, inspects, and uninstalls:

```powershell
node .verify/install-desktop.mjs --status      # inspect only; writes nothing
node .verify/install-desktop.mjs              # install (idempotent; re-run to repair)
node .verify/install-desktop.mjs --uninstall  # surgical uninstall (no wholesale restore from backup)
```

After installing you must **fully quit and reopen** DSH Desktop: HMR never hot-loads plugin rows, and the client-half loading decision is cached until restart. After the restart:

1. In the sidebar, choose “fork session” on a conversation → the new session title becomes `⤷ 来源：<source session title>` and a `⤷` badge appears at the start of the row;
2. **Rename** that forked session → the origin disappears from the title, but the `⤷` badge **is still there** and hovering still shows the source conversation name.

To check composition before restarting: `node --import ./test/register.mjs .verify/diagnose-desktop-compose.mjs` (read-only; reproduces host composition) and `node .verify/check-client-manifest.mjs` (read-only; pre-checks the client-half declaration against the `dsh-client-modules` rules).

> ⚠️ This plugin has **zero imports**, so it is not subject to the “junction install cannot resolve host packages” limitation that plugins with dependencies hit.
> ⚠️ On 2026-10-07 the app rewrote the profile manifest from its own state and dropped local `link:` dependencies together with the bundle entry; if that happens again, re-run the install command above (it is idempotent).

## Checks

| Purpose | Command |
|---|---|
| Offline: host behavior assertions (13, stubbed ctx) + client-half smoke test | `npm test` |
| Offline: client-half smoke test only (protocol / two seats / origin predicate / degradation / error containment) | `npm run client-smoke` |
| End-to-end on a real runtime (14; real Loader / SessionStore / session-title / session-query) | `npm run rm-test` |
| Pre-check: verify the `dsh.client` declaration against the `dsh-client-modules` rules | `node .verify/check-client-manifest.mjs` |
| Pre-check: reproduce `desktop` profile host composition (set `NPM_GLOBAL_ROOT` from `npm root -g` first, or point `DSH_ANCHOR_GLOBAL` at the `dsh` package) | `node --import ./test/register.mjs .verify/diagnose-desktop-compose.mjs` |
| **GUI on a real browser: headless Chrome + CDP asserts the sidebar row / badge / hover section / text colors (9)** | Run steps in [.verify/REPORT.md](.verify/REPORT.md) §7.3 |
| Pre-commit privacy check (staged content / full history) | [.privacy-tools/README.md](.privacy-tools/README.md) |
| Documentation structure lint | `node .verify/md-lint.mjs` |

The end-to-end harness starts a real DSH runtime under a temporary `DSH_HOME` inside the repository: it **does not touch the user's `~/.dsh`**, opens no port, and calls no model. Evidence and conclusions are in [.verify/REPORT.md](.verify/REPORT.md).

## Known limitations

- **The origin in the title does not survive a rename**: that is the inherent cost of writing a label into the title. **The sidebar badge does survive** (D009); both channels are on by default.
- **The title copy is a snapshot**: it records the source conversation's title at fork time; renaming the **source** conversation does not update it. The badge shows the **live** name.
- **Only new forks are labeled**: forks that existed before the plugin was loaded are not back-filled (no startup scan).
- **Labeling window**: for roughly 4.6 seconds after a fork (`settleMs 600` + `graceMs 4000`) the title keeps converging. A manual rename inside that window is **not** overwritten (the title is no longer in inherited form), but a title set to exactly `<source title> (N)` by someone else can still be marked.
- **The title gets pinned**: this uses `sessionTitle.rename()`, i.e. `source: { kind: 'user' }`. That is harmless for fork children — the first-prompt title provider already skips sessions with a parent — but do not use this plugin to name **non-fork** sessions.
- **`maxTitleBytes` truncates**: DSH defaults to 80 bytes, so a long source title is truncated at the tail by the official `rename`. Truncation keeps the head, so the `⤷ 来源：` prefix survives.
- **The client half has been machine-checked in a real browser** (headless Chrome + CDP, 9 checks pass: sidebar row, badge, tooltip, hover section, text colors, zero console errors) — see [.verify/REPORT.md](.verify/REPORT.md) §7.3.
- **Hover-section text colors are pinned to the official hover card**: that card is a dark menu material whose own CSS hard-codes its text colors as `#fff` / `#cfd3d6` / `#adb2b8` and **does not use theme tokens**. This plugin's hover section therefore uses those same fixed colors. (v0.1.1 used `--dsw-alias-label-primary`, which resolves to the light-theme near-black inside that card and matched the card background, making the text invisible; fixed in v0.1.2.) If DSH changes the card palette, this must follow — the A7/A8 GUI assertions will flag it.
- **Only measured on DSH 0.2.0-rc.2 / Windows**: the host contracts and client seats were verified against that version; a version change requires re-running the checks above.
- **Not done**: no fork creation, no subagent moving, no tree drawing, no parent-pointer changes, no sidecar files, no model-visible tools, no `single` slot, no overriding official rows.

## Relationship to similar plugins

Writing the origin into the session title is a proven approach ([dsh-autofork](https://github.com/vlln/dsh-autofork)'s `⑂n family root name`, [dsh-session-tree](https://github.com/Nirvana-Jie/dsh-session-tree)'s `Task (1) (1)`), but both **only label forks they create themselves**. The difference here is **entry-point coverage**: this plugin hooks the native `session/created`, so forks created through official entry points are labeled too. The survey and its sources are in [docs/PRIOR-ART.md](docs/PRIOR-ART.md).

Because this plugin **only labels and never takes over**, it can coexist with those plugins: titles they named first are passed through unchanged.

## Getting it, feedback, and license

| Item | Current state |
|---|---|
| How to get it | Public repository: [WindFromKadath/dsh-plugin-branch-origin](https://github.com/WindFromKadath/dsh-plugin-branch-origin). Clone it, then install it into a DSH profile through a `link:` directory link (see “Install and enable”) |
| Feedback channel | Reproducible problems and usage questions: [the issue tracker](https://github.com/WindFromKadath/dsh-plugin-branch-origin/issues). Change proposals: pull requests — see [MAINTAINER.md](MAINTAINER.md) for how changes are checked |
| License | MIT, see [LICENSE](LICENSE) (Copyright (c) 2026 WindFromKadath) |
| Third-party material | No bundled third-party code or assets; the README and `docs/PRIOR-ART.md` only link to other projects |
| Maintenance availability | Personal project, maintained as needed; no response-time or version-support commitment |

## Project entry points

- [AGENTS.md](AGENTS.md): takeover and maintenance rules (including this machine's environment facts and the dangerous boundaries).
- [MAINTAINER.md](MAINTAINER.md): author-side maintenance entry (current scope, understanding, adopted tradeoffs, acceptance, pre-publication checks).
- [docs/DESIGN.md](docs/DESIGN.md): source-level contracts and the judgment rule (each with `package/file:line`).
- [docs/PRIOR-ART.md](docs/PRIOR-ART.md): the 2026-10-07 prior-art survey.
- [tasks.csv](tasks.csv): tasks and acceptance.
- [.verify/REPORT.md](.verify/REPORT.md): real-runtime verification report.
- [.privacy-tools/README.md](.privacy-tools/README.md): how to run the pre-commit privacy check and what it covers.
