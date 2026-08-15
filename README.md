# MovieAPP

A personal media hub: a desktop app that catalogs your local movie collection (with posters/summaries pulled from TMDB) and can also launch emulators/ROMs, plus a small public showcase website.

## Structure

```
MovieAPP/
├── apps/
│   └── desktop/        # Electron + React desktop app (the real app)
│       ├── electron/   # Main process: file scanning, emulator launching, window
│       └── src/        # React UI (renderer process)
├── docs/                # Static showcase site, served via GitHub Pages (main branch /docs)
└── .github/             # Repo metadata
```

## Desktop app

Points at two local folders (configurable, defaults to Windows paths used during setup):

- `C:\MovieAPP\Movies` — your movie files. The app scans this folder, matches titles against TMDB for posters/summaries/ratings, and lets you play them.
- `C:\MovieAPP\Emulators` — put emulator executables (and your own legally-owned ROMs) here. The app lists them and can launch a ROM with its emulator.

### Setup

```bash
cd apps/desktop
npm install
cp .env.example .env   # add your TMDB API key
npm run dev
```

### Building a distributable

```bash
cd apps/desktop
npm run build
```

## TMDB API key

Metadata (posters, summaries, ratings) comes from [The Movie Database](https://www.themoviedb.org/). Get a free API key at Settings → API, and put it in `apps/desktop/.env` as `TMDB_API_KEY=...` (or paste it into the app's Settings tab, which stores it locally).

## Emulators & ROMs

This project only ever fetches/bundles **legitimate, open-source emulator software** (e.g. RetroArch, Dolphin, PCSX2). It does not download or distribute ROM files — those must be supplied by you from games you legally own.

## Showcase site

`docs/` is a static, dependency-free site. Enable it via **Settings → Pages → Deploy from a branch → main / docs** in this repo, no build step required.
