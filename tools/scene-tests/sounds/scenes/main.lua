-- Checks playing sounds with a volume and a pitch (sfx() and the Sound
-- piece, for a WAV file and a .sfx file), and songs with sample instruments
-- (a sound file played at each note's pitch): the rendered song is read
-- back and the length and pitch of each note are measured. Prints PASS or
-- FAIL for each check, then DONE (tools/scene-tests/run.mjs reads them). It
-- also prints a CHECKSUM line of the song, which run.mjs compares with the
-- editor's synthesizer.

local passed, failed = 0, 0

local function check(name, ok, detail)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or ""))
  end
end

local function near(a, b, eps) return type(a) == "number" and math.abs(a - b) <= eps end

local function errorOf(fn)
  local ok, err = pcall(fn)
  return ok and "" or tostring(err)
end

-- The part of samples [from, to) that sounds: its first and last samples
-- louder than 0.001, its frequency (rising zero crossings per second) and
-- its loudest sample.
local function measure(data, from, to)
  local first, last, crossings, top = nil, nil, 0, 0
  local prev = 0
  local rate = data:getSampleRate()
  for i = from, math.min(to, data:getSampleCount()) - 1 do
    local v = data:getSample(i)
    if math.abs(v) > 0.001 then
      first = first or i
      last = i
    end
    if prev < 0 and v >= 0 then crossings += 1 end
    prev = v
    if math.abs(v) > top then top = math.abs(v) end
  end
  if not first then return { length = 0, hz = 0, peak = 0 } end
  local seconds = (last - first + 1) / rate
  return { length = seconds, hz = crossings / seconds, peak = top }
end

local function readJSON(path)
  return smitten.json.decode(assert(smitten.filesystem.read(path)))
end

local function checks()
  -- sfx() with an options table, with numbers, and without.
  local s = sfx("tone", { pitch = 1.5, volume = 0.25 })
  check("sfx options: pitch", near(s:getPitch(), 1.5, 1e-4), s:getPitch())
  check("sfx options: volume", near(s:getVolume(), 0.25, 1e-4), s:getVolume())
  s = sfx("tone")
  check("sfx plain: pitch 1", near(s:getPitch(), 1, 1e-4), s:getPitch())
  check("sfx plain: volume 1", near(s:getVolume(), 1, 1e-4), s:getVolume())
  s = sfx("tone", 0.5, 2)
  check("sfx numbers: volume", near(s:getVolume(), 0.5, 1e-4), s:getVolume())
  check("sfx numbers: pitch", near(s:getPitch(), 2, 1e-4), s:getPitch())
  s = sfx("tone", { volume = 0.7 })
  check("sfx volume only: pitch stays 1", near(s:getPitch(), 1, 1e-4), s:getPitch())
  s = sfx("blip", { pitch = 0.8, volume = 0.6 })
  check("sfx of a .sfx file: pitch", near(s:getPitch(), 0.8, 1e-4), s:getPitch())
  check("sfx of a .sfx file: volume", near(s:getVolume(), 0.6, 1e-4), s:getVolume())
  s = sfx("sounds/tone.wav", { pitch = 0.9 + rnd(0.3) })
  check("sfx random pitch", s:getPitch() >= 0.9 and s:getPitch() <= 1.2, s:getPitch())
  s = sfx("tone", { pitch = 0 })
  check("sfx pitch 0 plays at the lowest pitch", near(s:getPitch(), 0.01, 1e-4), s:getPitch())
  s = smitten.audio.sfx("tone", { pitch = 1.25 })
  check("smitten.audio.sfx: pitch", near(s:getPitch(), 1.25, 1e-4), s:getPitch())
  local err = errorOf(function() sfx("tone", "loud") end)
  check("sfx: a volume that is not a number", err:find("volume must be a number", 1, true), err)
  check("sfx: the error is at the caller", err:find("scenes/main.lua:", 1, true), err)
  err = errorOf(function() sfx("tone", { pitch = "high" }) end)
  check("sfx: a pitch that is not a number", err:find("pitch must be a number", 1, true), err)

  -- The Sound piece with a recorded WAV file.
  local src = Voice:play()
  check("Sound piece: pitch", near(src:getPitch(), 1.5, 1e-4), src:getPitch())
  check("Sound piece: volume", near(src:getVolume(), 0.5, 1e-4), src:getVolume())
  check("Sound piece: duration", near(Voice:getDuration(), 0.2, 0.001), Voice:getDuration())
  Voice:stop()

  -- A song with sample instruments, rendered and measured.
  local song = readJSON("music/samples.song")
  local data = smitten.synth.renderSong(song, "music/samples.song")
  check("song: 44100 Hz", data:getSampleRate() == 44100, data:getSampleRate())
  check("song: four seconds", data:getSampleCount() == 4 * 44100, data:getSampleCount())

  local a = measure(data, 0, 44100)
  check("base note: plays the whole sound (0.2 s)", near(a.length, 0.2, 0.003), a.length)
  check("base note: at its own pitch (441 Hz)", near(a.hz, 441, 441 * 0.03), a.hz)
  check("base note: at its own volume", near(a.peak, 0.5, 0.01), a.peak)

  local b = measure(data, 44100, 88200)
  check("an octave lower, cut at the end of the note (0.05 s + 2 ms)", near(b.length, 0.052, 0.003), b.length)
  check("an octave lower: 220 Hz", near(b.hz, 220.5, 220.5 * 0.06), b.hz)

  local c = measure(data, 88200, 132300)
  check("an octave higher: half as long (0.1 s)", near(c.length, 0.1, 0.003), c.length)
  check("an octave higher: 882 Hz", near(c.hz, 882, 882 * 0.03), c.hz)

  local d = measure(data, 132300, 176400)
  check("not pitched: as it is for every note (0.2 s)", near(d.length, 0.2, 0.003), d.length)
  check("not pitched: 441 Hz", near(d.hz, 441, 441 * 0.03), d.hz)
  check("instrument volume", near(d.peak, 0.25, 0.01), d.peak)

  -- The same song as the game plays it, and the checksum for the editor.
  local tune = smitten.synth.song("music/samples")
  err = errorOf(function() tune:play() end)
  check("song plays", err == "", err)
  check("song duration", near(tune.duration, 4, 1e-6), tune.duration)
  tune:stop()
  err = errorOf(function() music("samples", { volume = 0.5 }) end)
  check("music() with sample instruments", err == "", err)
  check("music volume", near(smitten.audio.getMusic():getVolume(), 0.5, 1e-4), smitten.audio.getMusic():getVolume())
  stopMusic()
  local tuneSrc = Tune:play()
  check("Sound piece with the song", tuneSrc ~= nil, tuneSrc)
  Tune:stop()

  local native = (function() local _ = smitten.synth return require("love.synth.native") end)()
  local resolved = readJSON("music/samples.song")
  local sound = smitten.sound.newSoundData("sounds/tone.wav")
  for _, inst in ipairs(resolved.instruments) do inst.sample = sound end
  local _, _, _, sum = native.renderSong(resolved, false)
  print(("CHECKSUM %.0f"):format(sum))

  -- A sound file that is not there: a clear error. No file chosen: silent.
  song.instruments[1].sample = "../sounds/nope.wav"
  err = errorOf(function() smitten.synth.renderSong(song, "music/samples.song") end)
  check("missing sound file: says which", err:find("uses the sound file sounds/nope.wav", 1, true), err)
  check("missing sound file: names the instrument", err:find("instrument 1 (Tone)", 1, true), err)
  song.instruments[1].sample = ""
  local quiet
  err = errorOf(function() quiet = smitten.synth.renderSong(song, "music/samples.song") end)
  check("no sound file: no error", err == "", err)
  check("no sound file: that instrument is silent", quiet and measure(quiet, 0, 44100).length == 0)

  -- Old songs: a sound-effect and a synth instrument still render.
  local old = {
    bpm = 120, stepsPerBeat = 4, patternLength = 4, loop = false,
    channels = { { instrument = 0 }, { instrument = 1 } },
    instruments = { { type = "synth", wave = "sine" }, { type = "sfx", sfx = "../sounds/blip.sfx" } },
    patterns = { { notes = { { channel = 0, step = 0, length = 2, note = 69 }, { channel = 1, step = 2, note = 60 } } } },
    order = { 0 },
  }
  local oldData
  err = errorOf(function() oldData = smitten.synth.renderSong(old, "music/") end)
  check("old song renders", err == "" and oldData ~= nil, err)
  if oldData then
    local o = measure(oldData, 0, 11025)
    check("old song: the synth note is 440 Hz", near(o.hz, 440, 440 * 0.03), o.hz)
  end
end

function ready()
  local ok, err = pcall(checks)
  if not ok then
    failed += 1
    print("FAIL the checks stopped: " .. tostring(err))
  end
  print(`DONE {passed} passed, {failed} failed`)
end
