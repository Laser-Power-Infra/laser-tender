// hooks/useSmartsheetTenders.ts
// Fetches via Next.js server actions with 30s polling (read-only, no hard-refresh sync).
import { useState, useEffect, useCallback, useRef } from "react";
import { SmartsheetTender } from "@/types/smartsheetTender";
import { getSmartsheetTenders } from "@/actions/tenders";

interface UseSmartsheetTendersResult {
  data: SmartsheetTender[];
  loading: boolean;
  error: Error | null;
}

export const useSmartsheetTenders = (): UseSmartsheetTendersResult => {
  const [data, setData] = useState<SmartsheetTender[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const hasData = useRef(false);

  const fetchData = useCallback(async () => {
    if (!hasData.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const json = await getSmartsheetTenders();

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
    const interval = setInterval(() => fetchData(), 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { data, loading, error };
};

export default useSmartsheetTenders;
