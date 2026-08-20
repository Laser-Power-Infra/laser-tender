import fs from "fs";
import path from "path";

const DEFAULT_NETWORK_PATH = "Z:\\COSTING & INVOLVEMENT";
const COST_PREFIX = "COST|";
const EXCEL_EXTENSIONS = new Set([".xlsx", ".xls"]);

export const extractNumericDocket = (docketStr) => {
  if (!docketStr || typeof docketStr !== "string") return null;
  const trimmed = docketStr.trim();
  if (!trimmed || trimmed === "-") return null;
  const prefixMatch = trimmed.match(/(?:ENQ|ENG|ENC|FNO)[-_](\d+)/i);
  if (prefixMatch) return prefixMatch[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  const looseMatch = trimmed.match(/(\d{4,6})/);
  return looseMatch ? looseMatch[1] : null;
};

const getNetworkRoot = () => {
  const envPath = (process.env.COST_NETWORK_FILE_PATH || "").trim().replace(/^"|"$/g, "");
  return envPath || DEFAULT_NETWORK_PATH;
};

const pad2 = (n) => String(n).padStart(2, "0");

const getCandidateRoots = (docket) => {
  const root = getNetworkRoot();
  const suffixMatch = String(docket || "").match(/(\d{2})-(\d{2})$/);
  const candidates = [];

  if (suffixMatch) {
    const fromYear = 2000 + parseInt(suffixMatch[1], 10);
    const toYear = 2000 + parseInt(suffixMatch[2], 10);
    const first = `${fromYear}-${suffixMatch[2]}`;
    const second = toYear + 1 <= 2099 ? `${toYear}-${pad2(toYear + 1 - 2000)}` : null;
    const years = [first, second].filter(Boolean);
    for (const yearFolder of years) {
      const p = path.join(root, yearFolder);
      if (fs.existsSync(p)) candidates.push(p);
    }
  }

  return { root, candidates };
};

const basenameWithoutExtension = (name) => name.replace(/\.(xlsx|xls)$/i, "");

const isCostingFile = (name, docket) => {
  if (!/cost/i.test(name)) return false;
  const tokenRe = new RegExp(`(^|[^0-9])${docket}([^0-9]|$)`);
  return tokenRe.test(name);
};

const isExactCostingName = (name, docket) => {
  const base = basenameWithoutExtension(name);
  const exactRe = new RegExp(`costing[ _-]${docket}([^0-9]|$)`);
  return exactRe.test(base);
};

const walkDir = (dir, docket, exactMatches, looseMatches) => {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[CostingFileFinder] Skipping unreadable dir: ${dir} (${err.message})`);
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, docket, exactMatches, looseMatches);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!EXCEL_EXTENSIONS.has(ext)) continue;
      if (!isCostingFile(entry.name, docket)) continue;
      if (isExactCostingName(entry.name, docket)) exactMatches.push(fullPath);
      else looseMatches.push(fullPath);
    }
  }
};

export const findCostingFileRecursive = (docket) => {
  const numeric = extractNumericDocket(docket);
  if (!numeric) return null;

  const { root, candidates } = getCandidateRoots(docket);
  if (!fs.existsSync(root)) {
    console.warn(`[CostingFileFinder] Network path not accessible: ${root}`);
    return null;
  }

  const searchRoots = candidates.length > 0 ? candidates : [root];
  const startedAt = Date.now();

  for (const searchRoot of searchRoots) {
    const exactMatches = [];
    const looseMatches = [];
    console.log(`[CostingFileFinder] Recursive search for docket "${docket}" (${numeric}) under ${searchRoot}...`);
    walkDir(searchRoot, numeric, exactMatches, looseMatches);
    const match = exactMatches[0] || looseMatches[0] || null;
    if (match) {
      console.log(`[CostingFileFinder] Found ${numeric} in ${Date.now() - startedAt}ms: ${match}`);
      return match;
    }
  }

  console.log(`[CostingFileFinder] No file found for ${numeric} after ${Date.now() - startedAt}ms`);
  return null;
};

export const readCostingFile = (costingPath) => {
  if (!costingPath) return null;

  let resolvedPath = costingPath;
  if (resolvedPath.startsWith(COST_PREFIX)) {
    resolvedPath = resolvedPath.slice(COST_PREFIX.length);
  }
  resolvedPath = resolvedPath.trim().replace(/^"|"$/g, "");
  if (!resolvedPath) return null;

  try {
    const buffer = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType =
      ext === ".xls"
        ? "application/vnd.ms-excel"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return {
      buffer,
      fileName: path.basename(resolvedPath),
      mimeType,
    };
  } catch (err) {
    console.warn(`[CostingFileFinder] Failed to read costing file "${resolvedPath}": ${err.message}`);
    return null;
  }
};

export const COST_PREFIX_STR = COST_PREFIX;