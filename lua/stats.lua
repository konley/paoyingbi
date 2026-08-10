local cjson = require "cjson.safe"
local DATA = "/www/sites/paoyingbi/data/stats.json"

local function read_stats()
  local f = io.open(DATA, "r")
  if not f then
    return {
      total = 865,
      heads = 438,
      tails = 427,
      launched_at = "2025-06-23T08:00:00+00:00",
      updated_at = os.date("!%Y-%m-%dT%H:%M:%S+00:00"),
    }
  end
  local raw = f:read("*a")
  f:close()
  local data = cjson.decode(raw)
  if type(data) ~= "table" then
    return {
      total = 865,
      heads = 438,
      tails = 427,
      launched_at = "2025-06-23T08:00:00+00:00",
      updated_at = os.date("!%Y-%m-%dT%H:%M:%S+00:00"),
    }
  end
  data.total = tonumber(data.total) or 865
  data.heads = tonumber(data.heads) or 0
  data.tails = tonumber(data.tails) or 0
  return data
end

local function write_stats(data)
  local tmp = DATA .. ".tmp"
  local f = io.open(tmp, "w")
  if not f then
    return false
  end
  f:write(cjson.encode(data))
  f:close()
  os.rename(tmp, DATA)
  return true
end

local function days_since(iso)
  if type(iso) ~= "string" then
    return 183
  end
  local y, m, d = iso:match("^(%d+)%-(%d+)%-(%d+)")
  if not y then
    return 183
  end
  local t0 = os.time({ year = tonumber(y), month = tonumber(m), day = tonumber(d), hour = 0 })
  local now = os.time()
  local diff = math.floor((now - t0) / 86400)
  if diff < 1 then
    return 1
  end
  return diff
end

local method = ngx.req.get_method()
ngx.header["Content-Type"] = "application/json; charset=utf-8"
ngx.header["Cache-Control"] = "no-store"
ngx.header["Access-Control-Allow-Origin"] = "*"
ngx.header["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
ngx.header["Access-Control-Allow-Headers"] = "Content-Type"

if method == "OPTIONS" then
  ngx.status = 204
  return ngx.exit(204)
end

local function with_lock(fn)
  local resty_lock = require "resty.lock"
  local lock, create_err = resty_lock:new("paoyingbi_locks", { timeout = 3, exptime = 5 })
  if not lock then
    return nil, create_err or "lock_create"
  end
  local elapsed, lock_err = lock:lock("stats")
  if not elapsed then
    return nil, lock_err or "busy"
  end
  local ok, a, b = pcall(fn)
  lock:unlock()
  if not ok then
    return nil, a
  end
  return a, b
end

if method == "GET" then
  local data = read_stats()
  data.days = days_since(data.launched_at)
  return ngx.say(cjson.encode({ ok = true, data = data }))
end

if method == "POST" then
  ngx.req.read_body()
  local body = ngx.req.get_body_data() or ""
  local payload = cjson.decode(body) or {}
  local side = payload.side
  if side ~= "heads" and side ~= "tails" then
    -- server decides if client omits
    side = (math.random() < 0.5) and "heads" or "tails"
  end

  local data, err = with_lock(function()
    local s = read_stats()
    s.total = (tonumber(s.total) or 0) + 1
    if side == "heads" then
      s.heads = (tonumber(s.heads) or 0) + 1
    else
      s.tails = (tonumber(s.tails) or 0) + 1
    end
    s.updated_at = os.date("!%Y-%m-%dT%H:%M:%S+00:00")
    write_stats(s)
    return s
  end)

  if not data then
    ngx.status = 503
    return ngx.say(cjson.encode({ ok = false, error = err or "lock" }))
  end

  data.days = days_since(data.launched_at)
  return ngx.say(cjson.encode({ ok = true, side = side, data = data }))
end

ngx.status = 405
ngx.say(cjson.encode({ ok = false, error = "method_not_allowed" }))
