# Kartcade Lap Timer (rig app)

A small in-game window for Assetto Corsa (needs Custom Shaders Patch). Staff type the driver's name
(and email, to link their driver profile), press **START**, and the app records car, track and the best
valid lap. **STOP & SAVE** ends the session. Each new best lap uploads to the website leaderboard.

## Install on each rig (5 minutes)

1. Copy the `kartcade_laptimer` folder into `assettocorsa/apps/lua/`
   (usually `C:\Program Files (x86)\Steam\steamapps\common\assettocorsa\apps\lua\`).
2. Edit `config.ini` in that folder:
   - `RIG_ID`: a unique name per rig, e.g. `rig-03` or `motion-01`
   - `EQUIPMENT`: `rigs`, `karts` or `motion`
   - `RIG_KEY`: the same value as `RIG_KEY` in Vercel (Production)
   - `LOCAL_URL`: the front PC's TV hub, e.g. `http://192.168.1.50:8787` (see `hub/README.md`).
     Leave it blank if there's no TV hub.
3. Start a session, open the app bar on the right edge of the screen, click **Kartcade**, and drag the
   window into a corner. AC remembers the spot.

## Each driver

Type the name (and email if they have a driver profile) → **START** → drive → **STOP & SAVE**.
Invalid laps (track limits) are ignored. Works in single player and on the local LAN server.

## TV board

With `LOCAL_URL` set, the app also sends every lap, plus a live update each second, to the TV hub on the
front PC. The window shows "TV linked" when the hub answers. If the front PC is off, the app keeps
working and the website upload is unaffected. Up to 30 laps wait and are sent when the hub is back.

## First test

Try one rig first: a few laps, then STOP & SAVE, and check www.kartcade.com/leaderboard.
If the window shows "Upload failed", check the rig has internet and the RIG_KEY matches.
