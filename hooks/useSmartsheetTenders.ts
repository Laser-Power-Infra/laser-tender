// hooks/useSmartsheetTenders.ts
// Fetches via Next.js server actions with 30s polling.
import { useState, useEffect, useCallback, useRef } from "react";
import { SmartsheetTender } from "@/types/smartsheetTender";
import { getSmartsheetTenders, refreshCosting } from "@/actions/tenders";

interface CostingSummary {
  matched: number;
  total: number;
}

interface UseSmartsheetTendersResult {
  data: SmartsheetTender[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  refreshCosting: () => Promise<CostingSummary | null>;
}

export const useSmartsheetTenders = (): UseSmartsheetTendersResult => {
  const [data, setData] = useState<SmartsheetTender[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const hasData = useRef(false);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (forceRefresh || !hasData.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const json = await getSmartsheetTenders(forceRefresh);

      if (!json.success) {
        const msg = json.error || "Server error";
        throw new Error(msg);
      }

      const records: SmartsheetTender[] = (json.data as SmartsheetTender[]) || [];
      hasData.current = true;
      setData(records);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unexpected error fetching Smartsheet data"));
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
    await fetchData(true);
  }, [fetchData]);

  const handleRefreshCosting = useCallback(async () => {
    setError(null);
    try {
      const json = await refreshCosting();

      if (!json.success) {
        const msg = json.error || "Server error";
        throw new Error(msg);
      }

      const records: SmartsheetTender[] = (json.data as SmartsheetTender[]) || [];
      hasData.current = true;
      setData(records);
      return json.summary || null;
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to refresh costing data"));
      return null;
    }
  }, []);

  return { data, loading, error, refresh, refreshCosting: handleRefreshCosting };
};

export default useSmartsheetTenders;
