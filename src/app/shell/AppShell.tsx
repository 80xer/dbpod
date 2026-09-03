import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useOpenConnections } from "../../entities/connection/openConnections";

const ENV_COLOR: Record<string, string> = {
  local: "bg-gray-400",
  dev: "bg-green-500",
  stage: "bg-amber-500",
  prod: "bg-red-500",
};

function ConnectionRail() {
  const connections = useOpenConnections();
  const params = useParams({ strict: false }) as { connectionId?: string };
  if (connections.length === 0) return null;
  return (
    <nav aria-label="열린 연결" className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-gray-200 bg-gray-50 py-2">
      {connections.map(([id, p]) => (
        <Link
          key={id}
          to="/workspace/$connectionId"
          params={{ connectionId: id }}
          title={`${p.name} (${p.environment})`}
          aria-label={p.name}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white ${
            ENV_COLOR[p.environment] ?? "bg-gray-400"
          } ${params.connectionId === id ? "ring-2 ring-blue-500 ring-offset-1" : "opacity-70 hover:opacity-100"}`}
        >
          {p.name.slice(0, 2).toUpperCase()}
        </Link>
      ))}
      <Link
        to="/"
        title="연결 관리"
        aria-label="연결 관리"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-gray-400 text-gray-500 hover:bg-gray-200"
      >
        +
      </Link>
    </nav>
  );
}

export function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-white text-gray-900">
      <header className="flex shrink-0 items-center border-b border-gray-200 px-3 py-1.5">
        <h1 className="text-sm font-semibold tracking-tight">DBPod</h1>
        <span className="ml-2 text-xs text-gray-400">PostgreSQL client — MVP</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <ConnectionRail />
        <main className="min-h-0 min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
