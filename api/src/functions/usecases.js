// GET /api/usecases — live use-case library from aoi_usecases, grouped by E2E
// anchor, for the Section 7 grid. Azure Functions v4 (Node) model.
const { app } = require("@azure/functions");
const { dv } = require("../../shared/dataverse");

// Repair double-encoded UTF-8 (mojibake like â€œ â€™ â€") coming from source text.
// Only reinterprets when the tell-tale mojibake lead bytes are present.
function fixText(s) {
  if (!s) return s;
  if (/[ÂÃâ]/.test(s)) {
    try { return Buffer.from(s, "latin1").toString("utf8"); } catch (e) { return s; }
  }
  return s;
}

function cleanDomain(anchor) {
  const a = fixText(anchor);
  if (!a) return "Other";
  // anchors look like "Technical Presales · Bid management" — take the first segment
  return a.split(/[·\/|]|—/)[0].trim().slice(0, 60) || "Other";
}

app.http("usecases", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const select = "$select=aoi_usecasereference,aoi_aoiusecase1,aoi_e2eprocessanchor,aoi_capabilitydescription";
      const filter = "&$filter=statecode eq 0";
      const order = "&$orderby=aoi_usecasenumber asc";
      const res = await dv("GET", "aoi_usecases?" + select + filter + order);
      if (!res.ok) return { status: 502, body: "Use-case lookup failed: " + res.status };
      const data = await res.json();
      const order2 = [];
      const byDomain = {};
      (data.value || []).forEach(u => {
        const d = cleanDomain(u.aoi_e2eprocessanchor);
        if (!byDomain[d]) { byDomain[d] = []; order2.push(d); }
        byDomain[d].push({
          reference: u.aoi_usecasereference || "",
          name: fixText(u.aoi_aoiusecase1) || "",
                    description: fixText(u.aoi_capabilitydescription || "").slice(0, 400)
        });
      });
      const groups = order2.map(d => ({ domain: d, items: byDomain[d] }));
      return { jsonBody: groups };
    } catch (e) {
      context.error(e);
      return { status: 500, body: "usecases error: " + (e && e.message ? e.message : String(e)) };
    }
  }
});
