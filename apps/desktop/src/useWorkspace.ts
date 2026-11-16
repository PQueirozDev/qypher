import { useCallback, useEffect, useState } from 'react';
import { listen } from './bridge';
import { api, native } from './api';
import type { Scan, Snapshot } from './types';
import type { SourceScan } from './sourceTypes';
import type { LabRun } from './labTypes';
export function useWorkspace() {
  const [data, setData] = useState<Snapshot>({ projects: [], scans: [] });
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(native);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [sourceScans, setSourceScans] = useState<SourceScan[]>([]);
  const [labRuns, setLabRuns] = useState<LabRun[]>([]);
  const [error, setError] = useState('');
  const reconnect = useCallback(() => {
    setReady(false);
    setConnecting(true);
    setError('');
    setConnectionEpoch((old) => old + 1);
  }, []);
  const refresh = useCallback(async () => {
    const [snapshot, sources, labs] = await Promise.all([
      api.snapshot(),
      api.sourceHistory(),
      api.labHistory(),
    ]);
    setData(snapshot);
    setSourceScans(sources);
    setLabRuns(labs);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const subscriptions: (() => void)[] = [];
    const update = (scan: Scan) =>
      setData((old) => ({
        ...old,
        scans: [scan, ...old.scans.filter((s) => s.id !== scan.id)]
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
          .slice(0, 200),
      }));
    async function connect() {
      try {
        for (const [event, handler] of [
          ['scan-progress', (s: Scan) => update(s)],
          ['scan-finished', (s: Scan) => update(s)],
        ] as const) {
          const stop = await listen<Scan>(event, (e) => {
            if (!disposed) handler(e.payload);
          });
          if (disposed) {
            stop();
            return;
          }
          subscriptions.push(stop);
        }
        for (const event of ['source-progress', 'source-finished']) {
          const stop = await listen<SourceScan>(event, (e) => {
            if (!disposed)
              setSourceScans((old) =>
                [e.payload, ...old.filter((s) => s.id !== e.payload.id)]
                  .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
                  .slice(0, 100),
              );
          });
          if (disposed) {
            stop();
            return;
          }
          subscriptions.push(stop);
        }
        for (const event of ['lab-progress', 'lab-finished']) {
          const stop = await listen<LabRun>(event, (e) => {
            if (!disposed)
              setLabRuns((old) =>
                [e.payload, ...old.filter((run) => run.id !== e.payload.id)]
                  .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
                  .slice(0, 100),
              );
          });
          if (disposed) {
            stop();
            return;
          }
          subscriptions.push(stop);
        }
        const stop = await listen<string>('storage-error', (e) => {
          if (!disposed) setError(e.payload);
        });
        if (disposed) {
          stop();
          return;
        }
        subscriptions.push(stop);
        const [snapshot, sources, labs] = await Promise.all([
          api.snapshot(),
          api.sourceHistory(),
          api.labHistory(),
        ]);
        if (!disposed) {
          setData(snapshot);
          setSourceScans(sources);
          setLabRuns(labs);
          setReady(true);
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        if (!disposed) setConnecting(false);
      }
    }
    void connect();
    return () => {
      disposed = true;
      subscriptions.forEach((stop) => stop());
    };
  }, [connectionEpoch]);
  return {
    ...data,
    ready,
    connecting,
    reconnect,
    error,
    setError,
    refresh,
    sourceScans,
    labRuns,
    activeLab: labRuns.find((run) => run.status === 'running'),
    activeSource: sourceScans.find((s) => s.status === 'running'),
    busy:
      data.scans.some((s) => s.status === 'running') ||
      sourceScans.some((s) => s.status === 'running') ||
      labRuns.some((run) => run.status === 'running'),
    active: data.scans.find((s) => s.status === 'running'),
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
