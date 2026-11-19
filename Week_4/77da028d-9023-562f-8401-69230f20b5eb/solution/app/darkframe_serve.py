"""`serve`: starts the gateway, sky engine, ledger and push dispatcher as separate processes and keeps them running."""
import asyncio
import signal
import sys

SERVICES = ("darkframe.sky_engine.app", "darkframe.ledger.app", "darkframe.push_dispatcher.app", "darkframe.gateway.app")
RESTART_SECONDS = 1


async def keep_running(module: str, stopping: asyncio.Event) -> None:
    while not stopping.is_set():
        process = await asyncio.create_subprocess_exec(sys.executable, "-m", module)
        waiter = asyncio.create_task(process.wait())
        stopper = asyncio.create_task(stopping.wait())
        await asyncio.wait({waiter, stopper}, return_when=asyncio.FIRST_COMPLETED)
        if process.returncode is None:
            process.terminate()
            await process.wait()
        for task in (waiter, stopper):
            task.cancel()
        if not stopping.is_set():
            await asyncio.sleep(RESTART_SECONDS)


async def main() -> None:
    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(name, stopping.set)
    await asyncio.gather(*(keep_running(module, stopping) for module in SERVICES))


if __name__ == "__main__":
    asyncio.run(main())
