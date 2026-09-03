import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { openConnections } from "../../entities/connection/openConnections";
import type {
  AppError,
  ConnectionTestResult,
  Environment,
  ProfileDraft,
  TlsMode,
} from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";

const inputCls =
  "w-full rounded border border-gray-300 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500";
const labelCls = "block text-xs font-medium text-gray-600 mb-0.5";

type FormValues = {
  name: string;
  environment: Environment;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  tlsMode: TlsMode;
  readOnly: boolean;
};

const defaults: FormValues = {
  name: "",
  environment: "local",
  host: "localhost",
  port: "5432",
  database: "",
  username: "",
  password: "",
  tlsMode: "verify-full",
  readOnly: false,
};

function toDraft(v: FormValues): ProfileDraft {
  return {
    id: null,
    name: v.name.trim(),
    environment: v.environment,
    color: null,
    host: v.host.trim(),
    port: Number(v.port) || 5432,
    database: v.database.trim(),
    username: v.username.trim(),
    tlsMode: v.tlsMode,
    readOnly: v.readOnly,
    queryTimeoutMs: 60_000,
    maxRows: 500,
  };
}

function errText(e: unknown): string {
  const err = e as Partial<AppError>;
  return err?.message ? `${err.code ?? ""} ${err.message}` : String(e);
}

export function ConnectionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: ipc.profileList });
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [message, setMessage] = useState<string>("");

  const form = useForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      const draft = toDraft(value);
      try {
        await ipc.profileSave({
          profile: draft,
          secret: value.password
            ? { mode: "replace", password: value.password }
            : { mode: "prompt-each-time" },
        });
        // Password leaves the form state immediately after a successful save.
        form.setFieldValue("password", "");
        form.reset();
        setMessage("프로필 저장됨. 비밀번호는 OS Keychain에 보관됩니다.");
        void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      } catch (e) {
        setMessage(`저장 실패: ${errText(e)}`);
      }
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const v = form.state.values;
      return ipc.connectionTest({
        profileId: null,
        draft: toDraft(v),
        password: v.password || null,
      });
    },
    onSuccess: (r) => {
      setTestResult(r);
      setMessage("");
    },
    onError: (e) => {
      setTestResult(null);
      setMessage(`연결 테스트 실패: ${errText(e)}`);
    },
  });

  const connect = useMutation({
    mutationFn: async (profileId: string) => ipc.connectionOpen({ profileId }),
    onSuccess: (r) => {
      const profile = profiles.data?.find((p) => p.id === r.profileId);
      if (profile) openConnections.set(r.connectionId, profile);
      void navigate({ to: "/workspace/$connectionId", params: { connectionId: r.connectionId } });
    },
    onError: (e) => setMessage(`연결 실패: ${errText(e)}`),
  });

  const remove = useMutation({
    mutationFn: (profileId: string) => ipc.profileDelete(profileId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["profiles"] }),
    onError: (e) => setMessage(`삭제 실패: ${errText(e)}`),
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 md:flex-row">
      <section className="md:w-1/2">
        <h2 className="mb-3 text-sm font-semibold">저장된 연결</h2>
        {profiles.data?.length === 0 && (
          <p className="text-sm text-gray-500">저장된 연결이 없습니다. 오른쪽에서 새 프로필을 만드세요.</p>
        )}
        <ul className="flex flex-col gap-2">
          {profiles.data?.map((p) => (
            <li key={p.id} className="rounded border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                    {p.environment}
                  </span>
                  {p.readOnly && (
                    <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                      읽기 전용
                    </span>
                  )}
                  {p.tlsMode === "insecure" && (
                    <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                      TLS 미검증
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {p.username}@{p.host}:{p.port}/{p.database}
                {!p.hasStoredCredential && " · 비밀번호 미저장"}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={connect.isPending}
                  onClick={() => connect.mutate(p.id)}
                >
                  연결
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                  onClick={() => {
                    if (window.confirm(`'${p.name}' 프로필과 저장된 자격 증명을 삭제할까요?`))
                      remove.mutate(p.id);
                  }}
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="md:w-1/2">
        <h2 className="mb-3 text-sm font-semibold">새 연결 프로필</h2>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="name">
            {(f) => (
              <div>
                <label className={labelCls} htmlFor="f-name">이름</label>
                <input
                  id="f-name"
                  className={inputCls}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  required
                />
              </div>
            )}
          </form.Field>
          <div className="grid grid-cols-3 gap-2">
            <form.Field name="host">
              {(f) => (
                <div className="col-span-2">
                  <label className={labelCls} htmlFor="f-host">호스트</label>
                  <input
                    id="f-host"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value)}
                    required
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="port">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-port">포트</label>
                  <input
                    id="f-port"
                    className={inputCls}
                    inputMode="numeric"
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <form.Field name="database">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-db">데이터베이스</label>
                  <input
                    id="f-db"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value)}
                    required
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="username">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-user">사용자</label>
                  <input
                    id="f-user"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value)}
                    required
                  />
                </div>
              )}
            </form.Field>
          </div>
          <form.Field name="password">
            {(f) => (
              <div>
                <label className={labelCls} htmlFor="f-pw">비밀번호 (OS Keychain에 저장)</label>
                <input
                  id="f-pw"
                  type="password"
                  autoComplete="off"
                  className={inputCls}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
          <div className="grid grid-cols-2 gap-2">
            <form.Field name="tlsMode">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-tls">TLS</label>
                  <select
                    id="f-tls"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value as TlsMode)}
                  >
                    <option value="verify-full">verify-full (기본)</option>
                    <option value="verify-ca">verify-ca</option>
                    <option value="insecure">insecure (검증 없음)</option>
                  </select>
                  {f.state.value === "insecure" && (
                    <p className="mt-1 text-xs text-red-600">
                      경고: 서버 인증서를 검증하지 않습니다. 로컬 개발 전용.
                    </p>
                  )}
                </div>
              )}
            </form.Field>
            <form.Field name="environment">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-env">환경</label>
                  <select
                    id="f-env"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value as Environment)}
                  >
                    <option value="local">local</option>
                    <option value="dev">dev</option>
                    <option value="stage">stage</option>
                    <option value="prod">prod</option>
                  </select>
                </div>
              )}
            </form.Field>
          </div>
          <form.Field name="readOnly">
            {(f) => (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.state.value}
                  onChange={(e) => f.handleChange(e.target.checked)}
                />
                읽기 전용 연결
              </label>
            )}
          </form.Field>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? "테스트 중…" : "연결 테스트"}
            </button>
            <button
              type="submit"
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              저장
            </button>
          </div>
        </form>
        {testResult && (
          <div className="mt-3 rounded border border-green-200 bg-green-50 p-2 text-xs text-green-800">
            연결 성공 · {testResult.serverVersion.split(" on ")[0]} · {testResult.latencyMs}ms ·{" "}
            {testResult.currentUser}@{testResult.database}
            {testResult.isSuperuser && " · superuser (운영 DB에서는 권장하지 않음)"}
          </div>
        )}
        {message && <p className="mt-3 text-xs text-gray-600">{message}</p>}
      </section>
    </div>
  );
}
