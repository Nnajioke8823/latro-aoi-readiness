const { app } = require('@azure/functions');
const { dv } = require('../../shared/dataverse');

function cleanDomain(anchor) {
  if (!anchor) return 'Other';
  return anchor.split(/[·\/|]|—/)[0].trim().slice(0, 60) || 'Other';
}

app.http('usecases', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'usecases',
  handler: async (request, context) => {
    try {
      const select = '$select=aoi_usecasereference,aoi_aoiusecase1,aoi_e2eprocessanchor,aoi_capabilitydescription';
      const filter = '&$filter=statecode eq 0';
      const order = '&$orderby=aoi_usecasenumber asc';
      const res = await dv('GET', 'aoi_usecases?' + select + filter + order);
      if (!res.ok) {
        return { status: 502, body: 'Use-case lookup failed: ' + res.status };
      }
      const data = await res.json();
      const orderedDomains = [];
      const byDomain = {};
      (data.value || []).forEach(u => {
        const d = cleanDomain(u.aoi_e2eprocessanchor);
        if (!byDomain[d]) { byDomain[d] = []; orderedDomains.push(d); }
        byDomain[d].push({
          reference: u.aoi_usecasereference || '',
          name: u.aoi_aoiusecase1 || '',
          description: (u.aoi_capabilitydescription || '').slice(0, 140)
        });
      });
      const groups = orderedDomains.map(d => ({ domain: d, items: byDomain[d] }));
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: groups
      };
    } catch (e) {
      context.error(e);
      return { status: 500, body: 'Server error' };
    }
  }
});
