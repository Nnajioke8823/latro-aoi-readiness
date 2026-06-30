const { app } = require('@azure/functions');
const { dv, principal } = require('../../shared/dataverse');

const PARENT = 'lts_ltsassessmentresponses';   // entity set (verify in $metadata)
const CHILD  = 'lts_ltsusecaseratings';
const NAV    = 'lts_AssessmentResponse';        // child→parent navigation property

app.http('submit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'submit',
  handler: async (request, context) => {
    try {
      const body = await request.json().catch(() => ({}));
      const a = body.assessment || {};
      const ratings = Array.isArray(body.ratings) ? body.ratings : [];

      // confidential-not-anonymous: prefer signed-in identity
      const p = principal(request);
      if (p && p.userDetails) a.lts_respondentname = p.userDetails;

      if (!a.lts_surveyversion) a.lts_surveyversion = '1.0';
      a.lts_submissiondate = new Date().toISOString();

      // 1) parent
      const pr = await dv('POST', PARENT, a);
      if (!pr.ok) {
        const t = await pr.text();
        return { status: 502, body: 'Parent write failed: ' + pr.status + ' ' + t };
      }
      const parent = await pr.json();
      const id = parent.lts_ltsassessmentresponseid;

      // 2) children
      let written = 0;
      for (const r of ratings) {
        const row = {
          lts_usecasename: r.reference,
          lts_usecasereference: r.reference,
          lts_ucresponse: r.response
        };
        row[NAV + '@odata.bind'] = '/' + PARENT + '(' + id + ')';
        const cr = await dv('POST', CHILD, row);
        if (cr.ok) written++;
        else context.warn('child write failed', await cr.text());
      }

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: { id, childrenWritten: written }
      };
    } catch (e) {
      context.error(e);
      return { status: 500, body: 'Server error' };
    }
  }
});
