// GET /api/choices — reads each form column's OWN option set from Dataverse
// (works whether the column is LOCAL or synced to a GLOBAL choice), so the
// dropdown/radio values always match exactly what the column will accept.
// Keyed by the table COLUMN name the form uses. Azure Functions v4 (Node) model.
const { app } = require("@azure/functions");
const { dv } = require("../../shared/dataverse");

const PARENT = "lts_ltsassessmentresponse";   // entity LOGICAL name (singular)
const CHILD = "lts_ltsusecaserating";

// form column name  ->  entity the column lives on
const COLUMNS = {
  lts_programmegate: PARENT,
  lts_businessunit: PARENT,
  lts_function: PARENT,
  lts_officeregion: PARENT,
  lts_timeatlatro: PARENT,
  lts_e2eprocess: PARENT,
  lts_manualcoordtime: PARENT,
  lts_informationlocation: PARENT,
  lts_exceptionheaviness: PARENT,
  lts_reworkloss: PARENT,
  lts_aitoolusage: PARENT,
  lts_copilotscenario: PARENT,
  lts_gyrfamiliarity: PARENT,
  lts_teampreparedness: PARENT,
  lts_leadershippreparedness: PARENT,
  lts_reskillingsharerequired: PARENT,
  lts_ucresponse: CHILD,
  lts_domain: CHILD
};

async function readColumn(entity, col) {
  // read the picklist column's metadata; expand both local and global option sets
  const path = "EntityDefinitions(LogicalName='" + entity + "')/Attributes(LogicalName='" + col +
    "')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata" +
    "?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)";
  const res = await dv("GET", path);
  if (!res.ok) throw new Error(col + " " + res.status);
  const body = await res.json();
  const options = (body.OptionSet && body.OptionSet.Options) ||
                  (body.GlobalOptionSet && body.GlobalOptionSet.Options) || [];
  return options.map(function (o) {
    const lbl = o.Label && o.Label.UserLocalizedLabel && o.Label.UserLocalizedLabel.Label;
    return { value: o.Value, label: lbl || String(o.Value) };
  });
}

app.http("choices", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      const cols = Object.keys(COLUMNS);
      const results = await Promise.all(cols.map(c => readColumn(COLUMNS[c], c).catch(() => [])));
      const out = {};
      cols.forEach((c, i) => { out[c] = results[i]; });
      return { jsonBody: out };
    } catch (e) {
      context.error(e);
      return { status: 500, body: "choices error: " + (e && e.message ? e.message : String(e)) };
    }
  }
});
