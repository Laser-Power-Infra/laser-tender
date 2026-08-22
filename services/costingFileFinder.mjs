import fs from "fs";
import path from "path";
import crypto from "crypto";

const DEFAULT_NETWORK_PATH = "Z:\\COSTING & INVOLVEMENT";
const NETWORK_TAG = "costing|";
const ENC_MARKER = "ENC1.";
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
  const envPath = (
    process.env.COSTING_FILE_NETWORK_PATH ||
    process.env.COST_NETWORK_FILE_PATH ||
    ""
  ).trim().replace(/^"|"$/g, "");
  return envPath || DEFAULT_NETWORK_PATH;
};

const getEncryptionKey = () => {
  const secret = (process.env.COSTING_PATH_ENCRYPTION_KEY || "").trim().replace(/^"|"$/g, "");
  const material = secret || getNetworkRoot();
  if (!secret) {
    console.warn("[CostingFileFinder] COSTING_PATH_ENCRYPTION_KEY not set; deriving key from network path.");
  }
  return crypto.createHash("sha256").update(material).digest();
};

export const isPlainUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());

export const buildStoredPath = (relativePath) => `${NETWORK_TAG}${relativePath}`;

export const encryptStoredPath = (plaintext) => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_MARKER}${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
};

export const decryptStoredPath = (stored) => {
  if (!stored || !stored.startsWith(ENC_MARKER)) return null;
  try {
    const key = getEncryptionKey();
    const payload = stored.slice(ENC_MARKER.length);
    const parts = payload.split(".");
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch (err) {
    console.warn(`[CostingFileFinder] Decryption failed: ${err.message}`);
    return null;
  }
};

export const resolveNetworkPath = (storedPlaintext) => {
  if (!storedPlaintext || !storedPlaintext.startsWith(NETWORK_TAG)) return null;
  const root = getNetworkRoot().replace(/[\\/]+$/, "");
  const relative = storedPlaintext.slice(NETWORK_TAG.length);
  const sep = relative.startsWith("\\") || relative.startsWith("/") ? "" : "\\";
  return root + sep + relative;
};

const basenameWithoutExtension = (name) => name.replace(/\.(xlsx|xls)$/i, "");

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
    for (const yearFolder of [first, second].filter(Boolean)) {
      const p = path.join(root, yearFolder);
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  return { root, candidates };
};

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
    if (exactMatches.length > 0) return;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, docket, exactMatches, looseMatches);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!EXCEL_EXTENSIONS.has(ext)) continue;
      if (!isCostingFile(entry.name, docket)) continue;
      if (isExactCostingName(entry.name, docket)) { exactMatches.push(fullPath); return; }
      else looseMatches.push(fullPath);
    }
  }
};

export const findCostingFileRecursive = (docket) => {
  const numeric = extractNumericDocket(docket);
  if (!numeric) return null;

  const root = getNetworkRoot();
  const absRoot = root.replace(/[\\/]+$/, "");
  if (!fs.existsSync(root)) {
    console.warn(`[CostingFileFinder] Network path not accessible: ${root}`);
    return null;
  }

  const toRelative = (abs) =>
    abs.startsWith(absRoot) ? abs.slice(absRoot.length).replace(/^[\\/]+/, "") : abs;
  const { candidates } = getCandidateRoots(docket);
  const searchRoots = candidates.length > 0 ? candidates : [root];
  const startedAt = Date.now();

  let looseFallback = null;
  for (const searchRoot of searchRoots) {
    const exactMatches = [];
    const looseMatches = [];
    console.log(`[CostingFileFinder] Search for "${docket}" (${numeric}) under ${searchRoot}...`);
    walkDir(searchRoot, numeric, exactMatches, looseMatches);
    if (exactMatches.length > 0) {
      console.log(`[CostingFileFinder] Found ${numeric} in ${Date.now() - startedAt}ms: ${exactMatches[0]}`);
      return toRelative(exactMatches[0]);
    }
    if (!looseFallback && looseMatches.length > 0) looseFallback = looseMatches[0];
  }
  if (looseFallback) {
    console.log(`[CostingFileFinder] Found ${numeric} in ${Date.now() - startedAt}ms: ${looseFallback}`);
    return toRelative(looseFallback);
  }

  // Full-drive fallback only when candidates found nothing (correctness preserved)
  if (candidates.length > 0) {
    const exactMatches = [];
    const looseMatches = [];
    console.log(`[CostingFileFinder] Fallback full search for "${docket}" (${numeric}) under ${root}...`);
    walkDir(root, numeric, exactMatches, looseMatches);
    const match = exactMatches[0] || looseMatches[0] || null;
    if (match) {
      console.log(`[CostingFileFinder] Found ${numeric} in ${Date.now() - startedAt}ms: ${match}`);
      return toRelative(match);
    }
  }

  console.log(`[CostingFileFinder] No file found for ${numeric} after ${Date.now() - startedAt}ms`);
  return null;
};

export const readCostingFile = (storedPlaintext) => {
  const fullPath = resolveNetworkPath(storedPlaintext);
  if (!fullPath) return null;

  try {
    const buffer = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType =
      ext === ".xls"
        ? "application/vnd.ms-excel"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return {
      buffer,
      fileName: path.basename(fullPath),
      mimeType,
    };
  } catch (err) {
    console.warn(`[CostingFileFinder] Failed to read costing file "${fullPath}": ${err.message}`);
    return null;
  }
};