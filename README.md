# One Move Better

A tiny beginner-friendly chess coaching prototype.

The idea is simple: **don't just tell me my move was wrong; teach me why.**

## What this version does

- Play legal chess moves on an interactive board.
- Optionally tell the coach what you were trying to do.
- Analyse the position before and after your move with Stockfish.
- Compare your move with Stockfish's preferred move.
- Give a simple verdict and one beginner-friendly lesson.
- Show the engine's better move on the board.
- Save your recent lessons in your browser. No account or database.

## Run it

Serve the folder over HTTP rather than double-clicking index.html.

If Python is installed:

    python -m http.server 8000

Then visit http://localhost:8000

You can also deploy the folder as a static site.

## Costs

This prototype has no paid API and no database. Stockfish runs in the browser.

## Technical notes

- Chess rules: chess.js 1.4.0 via jsDelivr.
- Engine: Stockfish.js 19 lite single-threaded browser build via jsDelivr.
- Coaching text: rule-based for now.
- Storage: browser localStorage.

## Next milestone

Improve the "why?" layer: hanging pieces, removed defenders, forks, pins, missed checks and missed captures.

## Stockfish licence

Stockfish.js is GPLv3 software. This prototype loads the published browser build from jsDelivr rather than redistributing the engine files.

Deployment: GitHub Pages workflow configured.
