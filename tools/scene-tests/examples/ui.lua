local volume
local name
local greeting
local menu = "UI/Settings/Menu"

function setup()
  volume = root():find(menu .. "/VolumeRow/Volume")
  name = root():find(menu .. "/NameRow/Name")
  greeting = root():find("UI/Greeting")
end

steps = {
  { 0.3, function()
    check("the slider starts at the saved volume", near(volume.value, 0.8, 0.001), volume.value)
    local _, titleY = root():find(menu .. "/Title"):getRect()
    local _, rowY = root():find(menu .. "/VolumeRow"):getRect()
    check("the Column puts the row under the title", rowY > titleY + 20, rowY - titleY)
    volume.value = 0.3
    volume:emit("changed", 0.3)
    check("the volume is saved", near(load("volume", 0), 0.3, 0.001), load("volume", 0))
    name.text = "Ada"
    name:emit("blurred")
    check("the name is saved", load("name", "") == "Ada")
    root():find(menu .. "/Difficulty/Hard"):toggle()
  end },
  { 0.5, function()
    check("only one difficulty is ticked", root():find(menu .. "/Difficulty/Hard").checked and not root():find(menu .. "/Difficulty/Normal").checked)
    check("the difficulty is saved", load("difficulty", "") == "Hard", load("difficulty", ""))
    check("the greeting shows the values", greeting.text == "Hello, Ada! Volume 30%, Hard.", greeting.text)
    done()
  end },
}
