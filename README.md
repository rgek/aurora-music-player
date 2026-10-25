# Aurora Music Player

A fast, installable web app that puts **Spotify** and **SoundCloud** in one iOS-inspired player, with a real library, search, queue and system media-key support. Static files only: no backend, no build step, no stored secrets.

## Features

- **Spotify, fully inside Aurora** (Premium): sign in with PKCE, then play through Spotify's Web Playback SDK with working play/pause, next/previous, seek, volume, shuffle and repeat.
- **Browse and search**: your playlists, Liked Songs, saved albums, recently played and top tracks; search songs, artists, albums and playlists; album, artist and playlist pages.
- **Queue and likes**: add any song to the queue, see what's up next, heart songs to save them to your library.
- **SoundCloud with real controls**: paste a track or set link and control it from the same player bar. Links are remembered.
- **Links page**: paste any `open.spotify.com` or `soundcloud.com` link. Without Spotify Premium, Spotify links fall back to Spotify's own embedded player.
- **One player bar** that keeps playing while you browse, pauses the other source automatically, and hooks into media keys and lock-screen controls.
- **Customisable**: six tints, light/dark/auto theme, keyboard shortcuts (`Space`, `Shift`+`←/→`, `/`), installable as a PWA with offline app shell.

## Run it

Spotify sign-in needs a real web address, so open Aurora over **`http://127.0.0.1`** locally or **`https://`** when hosted (Spotify does not accept `localhost`).

```bash
python -m http.server 8080 --bind 127.0.0.1
# then open http://127.0.0.1:8080/
```

To use it from any device, host the folder on any static host. For GitHub Pages: *Settings → Pages → Deploy from branch → `main` / root*. Your address will look like `https://<user>.github.io/aurora-music-player/`.

## Connect Spotify (about two minutes)

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and create an app. Tick **Web API** and **Web Playback SDK**.
2. Add the **Redirect URI** shown on Aurora's *Settings* page, exactly as written (including the trailing slash).
3. Under **User management**, add the email of every Spotify account that will sign in.
4. Copy the app's **Client ID** into Aurora's *Settings*, press **Save**, then **Connect Spotify**.

### Spotify's rules for this kind of app

Aurora runs as a Spotify "development mode" app, which means:

- Playing music inside Aurora requires **Spotify Premium** (a Spotify restriction on all browser players).
- The app **owner must have Premium**, and a development app allows up to **5 users**, who must be added under User management.
- You can read the tracks of playlists you own or collaborate on. For playlists made by others, Spotify only shares the title and artwork, though you can still press Play.
- Search returns 10 results at a time ("Show more songs" loads the next 10).
- The Web Playback SDK does **not work on iPhone/iPad browsers**. Use SoundCloud and Links there, or a desktop/Android browser for Spotify.

## SoundCloud

SoundCloud no longer hands out new API keys, so Aurora drives SoundCloud's official embedded player through its Widget API. You get full playback controls, but no SoundCloud search or account library: paste links instead.

## Project layout

```
index.html            app shell
css/app.css           design system (light/dark, responsive)
js/app.js             boot, router, theme, navigation
js/player.js          unified now-playing model, controls, player bar, likes
js/views.js           all screens
js/spotify.js         PKCE auth, Web API client, Web Playback SDK wrapper
js/soundcloud.js      SoundCloud Widget API wrapper
js/store.js, ui.js    settings storage and DOM helpers
service-worker.js     offline app shell
aurora-player.html    redirect for the old URL
```

## Privacy

Everything stays in your browser (`localStorage`). Aurora talks only to Spotify, SoundCloud and their CDNs. There is no analytics and no server of ours.

## About the Windows installer

`Aurora-Music-Player-1.0.0-Windows.exe` is the original v1 desktop build and has not been rebuilt for this version. Use the web app or install it as a PWA from your browser's *Install app* option.
