-- A door that writes down what its Animator's call keys say.
creaks = ""

function creaked(what)
  creaks ..= (if creaks == "" then "" else ",") .. what
end
