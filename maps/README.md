# Balonche

Sketch on a dotted canvas, press Digitize, and end with a finished bubble map you can build from,
work in and show to people. "Балонче" means little balloon and speech bubble in Bulgarian.

This folder is the Maps section of Claude Meter. `npm run bundle:maps` in the repo root builds it into
`maps/build/`, and every desktop build ships that. It also runs by itself in a browser:

## Quick start

```sh
npm install
npm start
```

Open <http://127.0.0.1:3417>. The first run opens an example sketch. Press **Digitize**.

Node 24 or newer is required. `npm run dev` runs the same app with live reload on port 5173.

## How it works

1. **Sketch.** Draw with the mouse, touch or a pen. Press Enter to type where the pointer is.
2. **Digitize.** A local pass finds boxes, arrows and the words inside them at once. AI then streams
   proposals, and nothing changes until you accept it.
3. **Map.** The drawn lines are gone. Groups are candy-coloured bubbles in custom fonts. Export a plan
   for Claude Code, a Markdown file, a PNG or SVG image, or a JSON backup. Press F to present.

A box drawn with a coloured pen becomes a bubble of that colour. Press `?` in the app for every
shortcut. Shortcuts follow physical keys, so they work on the Bulgarian keyboard layout too.

## The AI

The server picks the first of these it finds:

1. An API key in `~/.config/balonche/anthropic-key` (mode 0600), or in `ANTHROPIC_API_KEY`. It uses
   Claude Opus 5.5.
2. The `claude` command from Claude Code. It uses your Claude Code plan and Claude Sonnet 5.5.
3. Nothing. Digitize still runs the local pass and says how to connect an AI.

Set `BALONCHE_PROVIDER` or `BALONCHE_MODEL` to override this. See `.env.example`.

The canvas leaves this computer only when you press Digitize. An image of the sketch is sent only
when it holds pen marks that may be handwriting. The server listens on 127.0.0.1 only.

## Where maps live

In this browser's database, saved after every change. Use **Export > JSON backup** to keep a copy
anywhere else, and **Export > Open a JSON backup** to bring one back.

## Tests

```sh
npm test            # unit tests
npm run test:e2e    # browser tests and speed budgets, using a fake AI and your installed Chrome
npm run typecheck
```

## Layout

| Folder | Job |
| --- | --- |
| `src/doc` | The map file, proposals, the example map |
| `src/state` | The store with undo, saving to the browser's database, JSON backups |
| `src/canvas` | Camera, dots, ink, every pointer gesture, typed text |
| `src/recognize` | The local pass, in a Web Worker |
| `src/digitize` | What pressing Digitize does |
| `src/map` | Bubbles, layout, arrows, map styles |
| `src/export` | Markdown, PNG, SVG |
| `src/ui` | Toolbars, panels, menus, shortcuts, presenting |
| `server` | The local API and the AI providers |
| `shared` | The contract between browser and server |
