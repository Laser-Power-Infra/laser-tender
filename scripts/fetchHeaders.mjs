import fs from "fs";
const env = fs.readFileSync(".env","utf8");
const get = k => {
  const re = new RegExp("^"+k+"\\s*=\\s*\"?([^\"\\n]+)\"?", "m");
  const m = env.match(re);
  return m ? m[1].trim().replace(/^"|"$/g,"") : null;
};
const token = get("SMARTSHEET_API_TOKEN");
const sheetId = get("SMARTSHEET_SHEET_ID");
if(!token||!sheetId){ console.error("missing"); process.exit(1); }
const url = "https://api.smartsheet.com/2.0/sheets/"+sheetId.trim();
const r = await fetch(url, {headers:{Authorization:"Bearer "+token.trim()}});
const t = await r.text();
if(!r.ok){ console.error("status",r.status, t.slice(0,2000)); process.exit(1); }
const j = JSON.parse(t);
console.log("Columns ("+j.columns.length+"):");
j.columns.forEach(c=> console.log(JSON.stringify(c.title)));
