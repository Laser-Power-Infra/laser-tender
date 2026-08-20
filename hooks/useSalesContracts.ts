// hooks/useSalesContracts.ts
// Fetches via Next.js server actions with 30s polling.
import { useState, useEffect, useCallback, useRef } from "react";
import { SalesContract } from "@/types/salesContract";
import { getSalesContracts, syncSalesContractsAction } from "@/actions/sales-contracts";

interface SyncResult {
  inserted: number;
  skipped: number;
  total: number;
}

interface UseSalesContractsResult {
  data: SalesContract[];
  loading: boolean;
  syncing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  sync: () => Promise<SyncResult | null>;
}

export const useSalesContracts = (): UseSalesContractsResult => {
  const [data, setData] = useState<SalesContract[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const hasData = useRef(false);

  const fetchData = useCallback(async () => {
    if (!hasData.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const json = await getSalesContracts();

      if (!json.success) {
        const msg = json.error || "Server error";
        throw new Error(msg);
      }

      const records: SalesContract[] = (json.data as SalesContract[]) || [];
      hasData.current = true;
      setData(records);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unexpected error fetching Sales Contract data"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const refresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const json = await syncSalesContractsAction();
      if (!json.success) {
        const msg = json.error || "Server error";
        throw new Error(msg);
      }
      await fetchData();
      return json.result || null;
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to sync Sales Contract data"));
      return null;
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  return { data, loading, syncing, error, refresh, sync };
};

export default useSalesContracts;
