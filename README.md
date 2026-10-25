# Aurora Music Player

Installable, lightweight web player with a customizable iOS-inspired interface. It hosts Spotify and SoundCloud official embeds side by side, so both sources can be used in the same app without sharing account credentials.

## Run locally

Use any static HTTP server from this directory, then open `aurora-player.html`. For example:

```powershell
python -m http.server 8080
```

Visit `http://localhost:8080/aurora-player.html` and use the browser's **Install app** option. The PWA shell works offline; provider embeds require an internet connection.

## Playback note

Spotify and SoundCloud playback is deliberately delegated to their official embedded players. Full account-linked queue control needs registered OAuth applications and compliance with each provider's playback rules.
