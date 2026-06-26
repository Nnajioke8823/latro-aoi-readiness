// POST /api/submit — writes one parent assessment row + one child rating row
// per marked use case. Scoring is owned by Dataverse formula columns (0–100),
// so this code never computes scores.
const { dv, principal } = require("../shared/dataverse");

const PARENT = "lts_ltsassessmentresponses";   // entity set (verify in $metadata)
const CHILD = "lts_ltsusecaseratings";
const NAV = "lts_AssessmentResponse";          // child→parent navigation property (verify name)

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const a = body.assessment || {};
    const ratings = Array.isArray(body.ratings) ? body.ratings : [];

    // confidential-not-anonymous: prefer the signed-in identity for the name
    const p = principal(req);
    if (p && p.userDetails) a.lts_respondentname = p.userDetails;
    if (!a.lts_surveyversion) a.lts_surveyversion = "1.0";
    a.lts_submissiondate = new Date().toISOString();

    // 1) parent
    const pr = await dv("POST", PARENT, a);
    if (!pr.ok) { context.res = { status: 502, body: "Parent write failed: " + pr.status + " " + (await pr.text()) }; return; }
    const parent = await pr.json();
    const id = parent.lts_ltsassessmentresponseid;

    // 2) children (one per marked use case)
    let written = 0;
    for (const r of ratings) {
      const row = {
        lts_usecasename: r.reference,
        lts_usecasereference: r.reference,
        lts_ucresponse: r.response          // integer value mapped on the client
      };
      row[NAV + "@odata.bind"] = "/" + PARENT + "(" + id + ")";
      const cr = await dv("POST", CHILD, row);
      if (cr.ok) written++; else context.log.warn("child write failed", await cr.text());
    }

    context.res = { headers: { "Content-Type": "application/json" }, body: { id, childrenWritten: written } };
  } catch (e) {
    context.log.error(e);
    context.res = { status: 500, body: "Server error" };
  }
};
