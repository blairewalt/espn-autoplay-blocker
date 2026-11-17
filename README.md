# ESPN Autoplay Blocker

A small Chrome / Chromium extension that stops videos on ESPN from playing
until you actually click them. It does nothing on any other site.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`, ...).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose this folder.

Requires Chrome/Chromium 111 or newer. Reload any ESPN tabs that were already open.

## What it does

On ESPN pages a video may only start when you:

- click on the video or its player (play button, poster image, controls), or
- press Enter, Space or `K` while the player has keyboard focus.

Everything else is blocked: the `autoplay` attribute, scripts calling
`play()` on page load, players that start when scrolled into view, and
videos that start by themselves after you follow a link to another story.
Blocked players get the same error the browser's built-in autoplay policy
gives them, so they just show their usual play button.

Once you start a video, that player keeps working normally (pre-roll ad
followed by the clip, pause/resume, seeking) until you move to another page.

## How it works

`content.js` is injected into the page's own JavaScript world at
`document_start`, before ESPN's scripts run. It:

- wraps `HTMLMediaElement.prototype.play` and rejects calls for `<video>`
  elements that have no matching recent user click or key press,
- strips the `autoplay` attribute and ignores the `autoplay` property,
- pauses any video that manages to start anyway.

It needs no permissions beyond running on ESPN domains, stores nothing and
makes no network requests.

## Supported sites

`espn.com` and all its subdomains, plus the regional sites listed under
`matches` in `manifest.json`. Add a line there if your regional domain is missing.

## Tests

`node test/run.js` loads the unpacked extension into Chromium via Playwright
and serves `test/fixture.html` as a stand-in for `www.espn.com`.
