// POST /api/submit — writes one parent assessment row + one child rating row per
// marked use case. Scoring is owned by Dataverse formula columns.
// Records are created AS the signed-in respondent (Created By = respondent) when
// impersonation is available, and the respondent's display NAME (not email) is stored.
// Azure Functions v4 (Node) model.
const { app } = require("@azure/functions");
const { dv, principal } = require("../../shared/dataverse");

const PARENT = "lts_ltsassessmentresponses";   // entity set (verify in $metadata)
const CHILD = "lts_ltsusecaseratings";
const NAV = "lts_AssessmentResponse";          // child→parent navigation property (verify name)

// pull a claim value from the SWA principal (matches exact typ or ".../<typ>")
function claim(p, names) {
  const cs = (p && p.claims) || [];
  for (const n of names) {
    const t = n.toLowerCase();
    const c = cs.find(x => { const k = (x.typ || "").toLowerCase(); return k === t || k.endsWith("/" + t); });
    if (c && c.val) return c.val;
  }
  return null;
}

app.http("submit", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const body = await request.json().catch(() => ({}));
      const a = body.assessment || {};
      const ratings = Array.isArray(body.ratings) ? body.ratings : [];

      // identity of the signed-in respondent
      const p = principal(request);
      const name = claim(p, ["name"]) || (p && p.userDetails) || null;   // display name, NOT email
      const oid = claim(p, ["objectidentifier", "oid"]);                 // Entra object id (for Created By)
      if (name) a.lts_respondentname = name;
      if (!a.lts_surveyversion) a.lts_surveyversion = "1.0";
      a.lts_submissiondate = new Date().toISOString();

      // 1) parent — create AS the respondent (Created By = respondent). If impersonation
      //    isn't available (privilege/user missing), fall back to the app user so the
      //    submission still succeeds.
      let caller = oid || null;
      let pr = await dv("POST", PARENT, a, caller);
      if (!pr.ok && caller) { caller = null; pr = await dv("POST", PARENT, a, null); }
      if (!pr.ok) return { status: 502, body: "Parent write failed: " + pr.status + " " + (await pr.text()) };
      const parent = await pr.json();
      const id = parent.lts_ltsassessmentresponseid;

      // 2) children — use the SAME caller that worked for the parent (so the Use Case
      //    Ratings rows also get Created By = respondent).
      let written = 0;
      for (const r of ratings) {
        const row = {
          lts_usecasename: r.reference,
          lts_usecasereference: r.reference,
          lts_ucresponse: r.response          // integer value mapped on the client
        };
        row[NAV + "@odata.bind"] = "/" + PARENT + "(" + id + ")";
        const cr = await dv("POST", CHILD, row, caller);
        if (cr.ok) written++; else context.warn("child write failed", await cr.text());
      }
      return { jsonBody: { id, childrenWritten: written } };
    } catch (e) {
      context.error(e);
      return { status: 500, body: "submit error: " + (e && e.message ? e.message : String(e)) };
    }
  }
});
