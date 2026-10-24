-- Kartcade Lap Timer (CSP Lua app) v0.2
-- Staff or driver types a name, presses Start, races, presses Stop.
-- Every new best valid lap is sent to the Kartcade leaderboard; Stop sends the final result.

local DIR = (ac.dirname and ac.dirname()) or __dirname or '.'
local cfg = ac.INIConfig.load(DIR .. '/config.ini', ac.INIFormat.Default)
local API_URL   = cfg:get('KARTCADE', 'API_URL', 'https://www.kartcade.com/api/rig-laps')
local RIG_ID    = cfg:get('KARTCADE', 'RIG_ID', 'rig-01')
local EQUIPMENT = cfg:get('KARTCADE', 'EQUIPMENT', 'rigs')
local RIG_KEY   = cfg:get('KARTCADE', 'RIG_KEY', '')

-- Fallback: read config.ini as plain text if the INI reader came back empty (path or format quirks).
local function rawConfig(key)
  for _, path in ipairs({ DIR .. '/config.ini', DIR .. '\\config.ini', 'apps/lua/kartcade_laptimer/config.ini' }) do
    local ok, text = pcall(io.load, path)
    if ok and type(text) == 'string' and #text > 0 then
      local v = text:match('\n%s*' .. key .. '%s*=%s*([^\r\n;]+)') or text:match('^%s*' .. key .. '%s*=%s*([^\r\n;]+)')
      if v then return (v:gsub('^%s+', ''):gsub('%s+$', ''):gsub('^"(.*)"$', '%1')) end
    end
  end
  return nil
end
if type(RIG_KEY) ~= 'string' or RIG_KEY == '' or RIG_KEY == 'paste-rig-key-here' then RIG_KEY = rawConfig('RIG_KEY') or '' end
if type(RIG_ID) ~= 'string' or RIG_ID == '' then RIG_ID = rawConfig('RIG_ID') or 'rig-01' end
RIG_KEY = tostring(RIG_KEY):gsub('%s', '')
local KEY_OK = #RIG_KEY >= 16 and RIG_KEY ~= 'paste-rig-key-here'

local GREEN, RED, DIM = rgbm(0.18, 0.62, 0.29, 1), rgbm(0.83, 0.14, 0.16, 1), rgbm(1, 1, 1, 0.55)

local state = 'idle'          -- idle | active | saved
local nameInput, emailInput = '', ''
local session = nil           -- { id, name, email, best, laps, lastLapCount }
local status, statusAt = '', 0

local function safe(fn, ...)  -- CSP APIs differ a little between versions; never crash the app
  local ok, v = pcall(fn, ...)
  if ok then return v end
  return nil
end

local function trackName()
  local name = safe(ac.getTrackName) or safe(ac.getTrackID) or safe(ac.getTrackFullID, '/') or 'unknown'
  local layout = safe(ac.getTrackLayout)
  if layout and layout ~= '' then name = name .. ' (' .. layout .. ')' end
  return name
end

local function fmt(ms)
  if not ms or ms <= 0 then return '--:--.---' end
  local m = math.floor(ms / 60000); local s = (ms % 60000) / 1000
  return string.format('%d:%06.3f', m, s)
end

local function setStatus(t) status, statusAt = t, os.clock() end

local function send(final)
  if not session or not session.best then
    if final then setStatus('No valid lap to save') end
    return
  end
  local body = JSON.stringify({
    rigId = RIG_ID, equipment = EQUIPMENT, sessionId = session.id,
    driverName = session.name, email = session.email,
    car = safe(ac.getCarName, 0) or 'unknown', carId = safe(ac.getCarID, 0) or '',
    track = trackName(), trackId = safe(ac.getTrackID) or '',
    lapTimeMs = session.best, laps = session.laps, final = final and true or false, rigKey = RIG_KEY,
  })
  web.post(API_URL, { ['Content-Type'] = 'application/json', ['X-Rig-Key'] = RIG_KEY }, body, function(err, response)
    if err or not response or response.status ~= 200 then
      local code = response and response.status or 0
      setStatus(code == 401 and 'Upload refused: RIG_KEY does not match the website'
        or ('Upload failed (' .. tostring(code ~= 0 and code or err) .. '), will retry on next lap'))
      session.pending = true
    else
      session.pending = false
      setStatus(final and 'Saved to leaderboard' or 'Best lap uploaded')
    end
  end)
end

local function start()
  local car = ac.getCar(0)
  session = {
    id = RIG_ID .. '-' .. tostring(os.time()),
    name = nameInput:gsub('^%s+', ''):gsub('%s+$', ''),
    email = emailInput:gsub('%s', ''),
    best = nil, laps = 0, lastLapCount = car and car.lapCount or 0,
  }
  state = 'active'
  setStatus('Timing ' .. session.name)
end

local function stop()
  send(true)
  state = 'saved'
end

function script.update(dt)
  if state ~= 'active' or not session then return end
  local car = ac.getCar(0)
  if not car then return end
  if car.lapCount > session.lastLapCount then
    session.lastLapCount = car.lapCount
    session.laps = session.laps + 1
    local lap = car.previousLapTimeMs
    local valid = car.isLastLapValid
    if valid == nil then valid = true end
    if lap and lap > 10000 and valid then
      if not session.best or lap < session.best then
        session.best = lap
        send(false)
      elseif session.pending then
        send(false)
      end
    elseif not valid then
      setStatus('Lap invalid (track limits)')
    end
  end
end

function script.windowMain(dt)
  ui.pushFont(ui.Font.Main)
  if state == 'idle' or state == 'saved' then
    ui.textColored('KARTCADE LAP TIMER  v0.2', RED)
    if not KEY_OK then ui.textColored('RIG_KEY missing in config.ini: laps will not upload', RED) end
    if state == 'saved' and session then
      ui.text('Last: ' .. session.name .. '  ' .. fmt(session.best))
    end
    ui.text('Driver name')
    nameInput = ui.inputText('##name', nameInput)
    ui.textColored('Email (links to driver profile)', DIM)
    emailInput = ui.inputText('##email', emailInput)
    local ready = #nameInput:gsub('%s', '') >= 2
    if ui.button(ready and 'START' or 'Type a name to start', vec2(ui.availableSpaceX(), 32)) and ready then
      start()
    end
  else
    ui.textColored(session.name, GREEN)
    ui.text((safe(ac.getCarName, 0) or '') .. '  @  ' .. trackName())
    ui.pushFont(ui.Font.Title)
    ui.text(fmt(session.best))
    ui.popFont()
    ui.textColored(session.laps .. ' laps  -  best valid lap', DIM)
    if ui.button('STOP & SAVE', vec2(ui.availableSpaceX(), 32)) then
      stop()
      nameInput, emailInput = '', ''
    end
  end
  if status ~= '' and os.clock() - statusAt < 8 then ui.textColored(status, DIM) end
  ui.popFont()
end
