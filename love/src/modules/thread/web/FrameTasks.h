/**
 * Smitten: engine work that runs on a thread on desktop LÖVE (refilling
 * streaming audio, decoding video) runs from the browser's frame loop
 * instead. The browser build has no OS threads, and Smitten has no
 * love.thread module.
 *
 * Part of Smitten's changes to LÖVE (zlib license, see love/license.txt).
 **/

#ifndef LOVE_THREAD_WEB_FRAMETASKS_H
#define LOVE_THREAD_WEB_FRAMETASKS_H

#include "common/config.h"

#ifdef LOVE_EMSCRIPTEN

#include <functional>

namespace love
{
namespace thread
{
namespace web
{

// Adds a callback that runs once per browser frame (and from a timer while
// the tab is hidden). Returns an id for removeFrameTask.
int addFrameTask(std::function<void()> task);
void removeFrameTask(int id);
void runFrameTasks();

} // web
} // thread
} // love

#endif // LOVE_EMSCRIPTEN

#endif // LOVE_THREAD_WEB_FRAMETASKS_H
