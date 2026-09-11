import { useQuery } from "@tanstack/react-query";
import { ipc } from "../../shared/ipc/invoke";
import { SqlEditor } from "../query-editor/SqlEditor";

export function RoutineDefinitionView({ connectionId, routineOid, title }: {
  connectionId: string;
  routineOid: number;
  title: string;
}) {
  const definition = useQuery({
    queryKey: ["routine-definition", connectionId, routineOid],
    queryFn: () => ipc.metadataGetRoutineDefinition({ connectionId, routineOid }),
    staleTime: 60_000,
  });
  return <section aria-label={`${title} 정의`} className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
      <span className="shrink-0 text-gray-500">읽기 전용</span>
      <button type="button" disabled={definition.isFetching} onClick={() => void definition.refetch()}
        className="shrink-0 rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50">새로고침</button>
    </div>
    {definition.isPending && <p role="status" className="p-3 text-sm text-gray-500">정의 코드 불러오는 중…</p>}
    {definition.isError && <p role="alert" className="p-3 text-sm text-red-600">정의 코드를 불러오지 못했습니다: {definition.error.message} <button type="button" className="underline" onClick={() => void definition.refetch()}>다시 시도</button></p>}
    {definition.data !== undefined && <div className="min-h-0 flex-1">
      <SqlEditor key={definition.dataUpdatedAt} initialSql={definition.data} readOnly />
    </div>}
  </section>;
}
