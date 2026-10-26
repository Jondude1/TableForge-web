# TableForge (web)

Session prep for Dungeon Masters, as an installable web app for phones and tablets. Open it at
**https://jondude1.github.io/TableForge-web/**

## Install it like an app

- **iPhone / iPad:** open the link in Safari → Share → **Add to Home Screen**. Do your setup from the home-screen icon; iOS keeps its data separate from Safari's.
- **Android (e.g. Galaxy Tab):** open the link in Chrome → ⋮ menu → **Add to Home screen** / **Install app**.

It runs full-screen and works offline after the first visit.

## Features

- **Forge** — NPCs, events, locations, dungeon rooms, magic items and story beats. Steer with your own words and vibe chips, pin keepers and regenerate the rest, reroll single cards, save to Ideas.
- **Story** — the overall plot, an outline of beats by act, Planned / In play / Done, "suggest next", and **Fill gap** between any two beats.
- **Ideas** — everything saved plus your own ideas; search, filter, favorite, mark used, send to the outline, Concepts or Loot.
- **Concepts** — a free-form board: add, drag, link and label connections.
- **Maps** — square-grid maps. Tap a square or press-and-hold then drag over an area, and ask for anything: "a lighthouse that takes up 4 squares", "a river running north to south", "make this corner a swamp". Paint terrain by hand, hold a feature to move it, undo any change.
- **Loot** — each character's magic items, rarity, attunement (3-item limit), charges, and a party stash.
- **Tables** — d4–d100 tables with generated entries, a dice tray and a roll log.

## Sync between devices

Settings → **Sync this campaign** shows a code. On the other device: Settings → **Join**, enter the code. Changes then flow both ways within a few seconds.

- No accounts or servers to run. Changes travel through several free public Nostr relays.
- Everything is encrypted on the device with a key derived from the sync code; relays only see scrambled data. Anyone with the code can read and edit the campaign, so share it only with your table.
- Each device keeps a full copy and works offline; edits merge per item (newest edit wins) when it reconnects. If a relay loses data, devices automatically re-send what's missing.

## AI

Settings → **Claude** and paste an API key from https://console.anthropic.com (entered once per device; never synced). Without a key, Offline mode uses built-in tables, and map requests understand sizes like "4 squares" or "3x2".

## Develop

```
npm install
npm run dev        # http://localhost:5173/TableForge-web/
npm run build
node test/relay.mjs   # local test relay; point the app at it with localStorage tf.relays = ["ws://localhost:7777"]
```

Pushing to `main` builds and deploys to GitHub Pages.

See [CREDITS.md](CREDITS.md) for design inspiration and licenses.
