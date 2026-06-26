# LTS AI Readiness — Azure Static Web App → Dataverse

A branded HTML survey hosted on **Azure Static Web Apps (SWA)** that writes directly into your
existing Dataverse tables. The browser only ever calls the **same-origin `/api`** routes (no CORS,
no tokens or secrets in the browser); the SWA-managed **Azure Functions** call the Dataverse Web API
server-side with an application user.

```
Browser (index.html) ──→ SWA Entra sign-in (identity)
        │
        ├─ GET  /api/choices  ─→ Function ─→ Dataverse  global Choices  (live dropdowns/radios: values+labels)
        ├─ GET  /api/usecases ─→ Function ─→ Dataverse  aoi_usecases    (live Section 7 grid)
        └─ POST /api/submit    ─→ Function ─→ Dataverse  lts_ltsassessmentresponses (+ lts_ltsusecaseratings)
```

Choice option **values and labels are read live from your published global Choices** — there is
no hand-maintained value map.

Scoring is owned by **Dataverse formula columns (0–100)** — the app writes raw answers only.

## Folder structure
```
/                         staticwebapp.config.json   (Entra auth + route protection)
/app                      index.html, styles.css, app.js, logo.png
/api                      host.json, package.json
/api/choices              GET  → reads global Choice option sets (values + labels)
/api/usecases             GET  → reads aoi_usecases
/api/submit               POST → writes parent + child rows
/api/shared/dataverse.js  certificate-based token (MSAL) + fetch helper
```

## Prerequisites
- Azure subscription + resource group; an **Azure Static Web App (Standard plan)** for managed Functions + Entra auth.
- Microsoft Entra **admin** to register apps and grant admin consent.
- A **GitHub** (or Azure DevOps) repo — SWA deploys from it.
- Your Dataverse environment URL `https://<org>.crm.dynamics.com` and the tables (already built).

## One-time setup

### 1. App registration for the Dataverse write (certificate — no secret)
1. Entra → App registrations → New → `LTS-Readiness-API`. Copy **Application (client) ID** and **Directory (tenant) ID**.
2. Obtain an X.509 certificate from your CA/PKI. Upload its **public key (.cer)** under
   Certificates & secrets → **Certificates**. Keep the **private key** in Key Vault
   (recommended) or the Function App certificate store — never as a client secret.

### 2. Dataverse application user + role
3. Power Platform Admin → your environment → Settings → Users + permissions → **Application users** → New → paste the client ID from step 1.
4. Create a security role with **Create** + **Append-To** on `lts_ltsassessmentresponses` and `lts_ltsusecaserating`, and **Read** on `aoi_usecases`; assign it to that application user.

### 3. Sign-in (identity for confidential-not-anonymous)
5. Either use the SWA default Entra provider, **or** register a second app `LTS-Readiness-SignIn` (redirect `https://<your-swa>/.auth/login/aad/callback`) and reference it in `staticwebapp.config.json` (`AAD_CLIENT_ID` / `AAD_CLIENT_SECRET`). Replace `<TENANT_ID>` in that file.

### 4. Certificate source + application settings

**Where the private key lives — pick one:**
- **Key Vault (recommended):** import the certificate (or its PEM) into Key Vault. Enable a
  **managed identity** on the Function App and grant it **Get** on secrets (RBAC role
  *Key Vault Secrets User*, or an access policy). The app reads the cert at runtime via
  that identity — no credential in config.
- **Function App certificate store:** upload the **.pfx** to the Function App
  (Certificates → Bring your own), and set app setting `WEBSITE_LOAD_CERTIFICATES` to the
  thumbprint. The app reads `/var/ssl/private/<thumbprint>.p12`.

> **Hosting note:** managed-identity Key Vault access and the certificate store require a
> **standalone / linked Azure Function App** (Static Web Apps *Bring your own functions*,
> Standard plan). SWA-*managed* functions don't support managed identity or the cert store.
> The code is identical — only the hosting model changes.

**Application settings (Function App → Configuration):**
| Name | Value |
|------|-------|
| `TENANT_ID` | your tenant GUID |
| `CLIENT_ID` | client ID of `LTS-Readiness-API` |
| `DATAVERSE_URL` | `https://<org>.crm.dynamics.com` |
| `CERT_SOURCE` | `keyvault` (default) or `filestore` |
| `KEY_VAULT_URL` + `CERT_NAME` | Key Vault URL and the certificate's secret name (when `CERT_SOURCE=keyvault`) |
| `CERT_THUMBPRINT` *(+ optional `CERT_P12_PATH`, `CERT_PASSWORD`)* | when `CERT_SOURCE=filestore` |
| `AAD_CLIENT_ID` / `AAD_CLIENT_SECRET` | only if using a custom sign-in app (step 5) |

### 5. Deploy
6. Push this folder to your repo (`main` branch). A workflow is already included at
   `.github/workflows/azure-static-web-apps.yml` (app location `app`, api location `api`).
   Create the Static Web App in Azure, copy its **deployment token** (portal → your SWA →
   *Manage deployment token*), and add it to the repo as the secret
   **`AZURE_STATIC_WEB_APPS_API_TOKEN`** (Settings → Secrets and variables → Actions).
   Every push to `main` then builds and deploys automatically; HTTPS is automatic.

## ⚠️ Verify these before go-live
1. **`api/choices/index.js`** — the `COLUMN_TO_CHOICE` map points each form column at its **global Choice logical name**. A few choice names differ slightly from their column names (already set): `lts_e2eprocess → lts_e2eproces`, `lts_manualcoordtime → lts_manualcoordtim`, `lts_informationlocation → lts_infolocation`, `lts_reskillingsharerequired → lts_reskillingshare`. Confirm these against your solution if `/api/choices` returns empty arrays.
2. **`api/submit/index.js`** — verify against your environment:
   - `PARENT` / `CHILD` **entity-set (collection) names** — confirm via `GET <DATAVERSE_URL>/api/data/v9.2/$metadata` if a write 404s.
   - `NAV` = the **child→parent navigation property** for the `lts_assessmentresponse` lookup (the relationship schema name).
3. **Score columns** — confirm `lts_adoptionscore`, `lts_safetyscore`, `lts_qualityscore`, `lts_speedscore`, `lts_aoireadinessindex` are **formula columns (0–100)** so they auto-calculate on save. The app intentionally does not send scores.
4. **App-user privilege** — the application user needs to **read option-set metadata** for `/api/choices` (most roles allow this; if it 403s, add metadata/customization read).
5. *(Optional)* the child `lts_domain` (Use Case Domain) and a master-table **lookup** to `aoi_usecases` are not written today — add them in `submit/index.js` if you want it.

## Test checklist
- Browse the site → you are redirected to Entra sign-in.
- Section 7 grid loads from `aoi_usecases` (live list).
- Submit a test response → one row in `lts_ltsassessmentresponses`, child rows in `lts_ltsusecaseratings`, the five score columns populated (0–100), and `lts_respondentname` = the signed-in user.

## Notes
- Barriers (Q16) and capability gaps (Q20) are shown for context but **not persisted** — no columns exist for them. Add multi-select choice columns if you want them stored.
- Local testing: install the **SWA CLI** + **Azure Functions Core Tools** and run `swa start app --api-location api`.
