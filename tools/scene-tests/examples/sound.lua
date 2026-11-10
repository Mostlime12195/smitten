local button


function setup()
  button = root():find("UI/MusicButton")
end

steps = {
  { 1.0, function()
    local m = smitten.audio.getMusic()
    check("the song plays", m ~= nil and m:isPlaying())
    root():find("UI/Pads/Drum"):emit("clicked")
    root():find("UI/Pads/Low"):emit("clicked")
    check("the pads play their sounds", true)
    button:emit("clicked")
    check("the button stops the music", button.text == "Play the music" and not button.musicOn)
  end },
  { 1.8, function()
    button:emit("clicked")
    local m = smitten.audio.getMusic()
    check("the button starts the music again", m ~= nil and m:isPlaying())
    done()
  end },
}
