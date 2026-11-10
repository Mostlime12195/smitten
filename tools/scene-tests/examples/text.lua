local box
local words
local letters = 0

function setup()
  box = root():find("UI/Box")
  words = root():find("UI/Box/Words")
  words:on("revealed", function() letters += 1 end)
end

local long = string.rep("word ", 100)
local second = string.rep("next ", 100)

steps = {
  { 0, function()
    -- Wait for the first line of the example.
    if not box.visible or not words.text:find("Ada") or letters < 3 then return false end
    check("the box shows the first line, one letter after the other", true)
    -- A long line, so that the next key press comes before its end.
    words:say({ long, second })
  end },
  { 0.1, function()
    if words.visibleCharacters < 1 then return false end
    tap("accept")
  end },
  { 0.2, function()
    check("a key press shows all of the line", words.visibleCharacters == -1 and words.text == long, words.visibleCharacters)
    tap("accept")
  end },
  { 0.3, function()
    check("the next key press shows the next line", words.text == second and words.visibleCharacters >= 0, words.visibleCharacters)
    tap("accept")
  end },
  { 0.35, function()
    check("a key press shows all of it", words.visibleCharacters == -1, words.visibleCharacters)
    tap("accept")
  end },
  { 0.4, function()
    check("after the last line, the box closes", not box.visible)
  end },
  { 1.4, function()
    check("then the prompt shows", root():find("UI/Prompt").visible)
    done()
  end },
}
