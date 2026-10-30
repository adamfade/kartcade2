# Kartcade TV hub

Runs on the front PC and drives the lounge TV. The rigs send laps here over the shop network, so the
board works without the internet and without the website. The website upload from the rigs is unchanged.

- **TV board:** `http://localhost:8787/tv` (full screen on the wireless TV)
- **Control page:** `http://<front PC address>:8787/control` (phone or shop PC on the shop network)

## What the TV shows

**Leaderboard:** today's and this week's fastest drivers for the track and car combos used most
recently. It rotates every 15 seconds when there's more than one.

**Race:** one tile per rig with the driver, a live lap clock, best lap, last lap (struck through if
invalid) and lap count, plus standings. The rig holding the fastest lap is outlined in green.
The toggle on the control page switches what counts, and you can flip it at any time:
- **All laps:** every valid lap since Start, any track or car.
- **This track & car:** only laps on the race's track and car. Pick them when starting, or leave
  "Set from the first lap after Start".

End race keeps the final results on the TV. Clear goes back to the leaderboard.

## Set up the front PC (once)

1. **Install Node.js LTS** from https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`).
2. **Copy the `hub` folder** to the front PC, e.g. `C:\Kartcade\hub`.
3. **Set the TV as an extended display.** Connect the wireless adapter, press Win+P and choose
   **Extend**. In Settings > Display, place the TV to the right of the main screen.
4. **Run the installer** in PowerShell as administrator:
   ```
   powershell -ExecutionPolicy Bypass -File C:\Kartcade\hub\windows\install.ps1
   ```
   It opens port 8787 on the local network, starts the hub and the TV board now and at every
   sign-in, and prints this PC's address.
5. **Reserve that address** in the router so it never changes (see below).
6. **On each rig**, set `LOCAL_URL = http://<that address>:8787` in
   `assettocorsa\apps\lua\kartcade_laptimer\config.ini`, and copy in the v0.3
   `kartcade_laptimer.lua`. The lap timer window shows "TV linked" when it's working.

If the board opens on the wrong screen, edit `TV_X` at the top of `windows\start-tv.bat`
(the left edge of the TV screen in pixels). To exit the full-screen board, press Alt+F4 on it.
Press R on it to reload.

## Reserve the front PC's address

The router setting is usually called **DHCP reservation**, **address reservation** or **static lease**.
You'll need the front PC's MAC address: run `ipconfig /all` and copy the **Physical Address** of the
adapter that's connected (Ethernet or Wi-Fi). In the router's admin page, add a reservation for that MAC
with the address the installer printed, then restart the front PC.

## Check it without a rig

```
node server.js                 # in one window
node tools/fake-rigs.js 6      # in another: 6 pretend rigs driving laps
```
Open http://localhost:8787/tv and http://localhost:8787/control.

## Files

- `server.js`: the hub (Node only, no npm packages). Laps are kept in `data/laps.jsonl` for 120 days,
  races and TV mode in `data/state.json`, logs in `data/hub.log`.
- `public/`: the TV and control pages, with fonts bundled so nothing loads from the internet.
- `windows/`: installer and start-up scripts.
- `tools/fake-rigs.js`: test data.

The hub only answers devices on the local network. Anyone on the same network can open the control
page, so keep customer Wi-Fi on a separate guest network.
