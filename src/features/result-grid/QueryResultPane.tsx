import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { resultStore } from "../../entities/result/resultStore";
import { queryEditability, type Editability } from "../data-editing/editability";
import { EditBar } from "../data-editing/EditBar";
import { ResultGrid } from "./ResultGrid";

/** Query-result grid plus editability detection (conservative, spec §3.2). */
export function QueryResultPane({
  connectionId,
  resultTabId,
  readOnly,
}: {
  connectionId: string;
  resultTabId: string;
  readOnly: boolean;
}) {
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => resultStore.subscribe(resultTabId, cb), [resultTabId]),
    () => resultStore.getSnapshot(resultTabId),
  );
  const [editability, setEditability] = useState<Editability | null>(null);

  useEffect(() => {
    let stale = false;
    setEditability(null);
    if (snapshot.status === "completed" && snapshot.columns.length > 0) {
      void queryEditability(connectionId, snapshot.executedSql, snapshot.columns, readOnly).then(
        (r) => {
          if (!stale) setEditability(r);
        },
      );
    }
    return () => {
      stale = true;
    };
    // re-detect per execution, not per row chunk
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, resultTabId, readOnly, snapshot.status, snapshot.executionId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {editability && (
        <EditBar connectionId={connectionId} resultTabId={resultTabId} editability={editability} />
      )}
      <div className="min-h-0 flex-1">
        <ResultGrid
          resultTabId={resultTabId}
          edit={editability?.editable ? { editableColumns: editability.editableColumns } : undefined}
        />
      </div>
    </div>
  );
}
