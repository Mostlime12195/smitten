/**
 * Smitten: per-frame engine tasks (see FrameTasks.h).
 *
 * Part of Smitten's changes to LÖVE (zlib license, see love/license.txt).
 **/

#include "FrameTasks.h"

#ifdef LOVE_EMSCRIPTEN

#include <map>

namespace love
{
namespace thread
{
namespace web
{

namespace
{
std::map<int, std::function<void()>> frameTasks;
int nextTaskID = 1;
}

int addFrameTask(std::function<void()> task)
{
	int id = nextTaskID++;
	frameTasks[id] = std::move(task);
	return id;
}

void removeFrameTask(int id)
{
	frameTasks.erase(id);
}

void runFrameTasks()
{
	for (auto &task : frameTasks)
		task.second();
}

} // web
} // thread
} // love

#endif // LOVE_EMSCRIPTEN
