// GET /api/choices — reads option VALUES + LABELS straight from your published
// global Choices and returns them keyed by the table COLUMN name the form uses.
// No hand-maintained value map; always in sync with Dataverse.
const { dv } = require("../shared/dataverse");

// form column name  →  global Choice (option set) logical name
const COLUMN_TO_CHOICE = {
  lts_programmegate: "lts_programmegate",
  lts_businessunit: "lts_businessunit",
  lts_function: "lts_function",
  lts_officeregion: "lts_officeregion",
  lts_timeatlatro: "lts_timeatlatro",
  lts_e2eprocess: "lts_e2eproces",
  lts_manualcoordtime: "lts_manualcoordtim",
  lts_informationlocation: "lts_infolocation",
  lts_exceptionheaviness: "lts_exceptionheaviness",
  lts_reworkloss: "lts_reworkloss",
  lts_aitoolusage: "lts_aitoolusage",
  lts_copilotscenario: "lts_copilotscenario",
  lts_gyrfamiliarity: "lts_gyrfamiliarity",
  lts_teampreparedness: "lts_teampreparedness",
  lts_leadershippreparedness: "lts_leadershippreparedness",
  lts_reskillingsharerequired: "lts_reskillingshare",
  lts_ucresponse: "lts_ucresponse"
};

async function readOptionSet(name) {
  // GlobalOptionSetDefinitions returns Options[] with Value + localized Label
  const res = await dv("GET", "GlobalOptionSetDefinitions(Name='" + name + "')");
  if (!res.ok) throw new Error(name + " " + res.status);
  const body = await res.json();
  return (body.Options || []).map(function (o) {
    const lbl = o.Label && o.Label.UserLocalizedLabel && o.Label.UserLocalizedLabel.Label;
    return { value: o.Value, label: lbl || String(o.Value) };
  });
}

module.exports = async function (context) {
  try {
    const cols = Object.keys(COLUMN_TO_CHOICE);
    const results = await Promise.all(cols.map(c => readOptionSet(COLUMN_TO_CHOICE[c]).catch(() => [])));
    const out = {};
    cols.forEach((c, i) => { out[c] = results[i]; });
    context.res = { headers: { "Content-Type": "application/json" }, body: out };
  } catch (e) {
    context.log.error(e);
    context.res = { status: 500, body: "Choice lookup failed" };
  }
};
