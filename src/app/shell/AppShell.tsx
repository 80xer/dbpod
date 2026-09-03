import { Outlet } from "@tanstack/react-router";

export function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-white text-gray-900">
      <header className="flex shrink-0 items-center border-b border-gray-200 px-3 py-1.5">
        <h1 className="text-sm font-semibold tracking-tight">DBPod</h1>
        <span className="ml-2 text-xs text-gray-400">PostgreSQL client — MVP</span>
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
