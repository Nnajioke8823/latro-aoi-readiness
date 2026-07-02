// Shared Dataverse helper — CERTIFICATE-BASED auth (client credentials with a
// certificate). No client secret. The certificate is loaded at runtime from
// Azure Key Vault (via managed identity) or the Function App certificate store.
//
// Token acquisition uses MSAL Node, which builds and signs the client assertion
// from the certificate (SNI / x5c enabled for safe rotation).
//
// Required app settings:
//   TENANT_ID, CLIENT_ID, DATAVERSE_URL
//   CERT_SOURCE = "keyvault" (default) | "filestore"
//   keyvault : KEY_VAULT_URL, CERT_NAME           (managed identity reads the secret)
//   filestore: CERT_THUMBPRINT  (+ optional CERT_P12_PATH, CERT_PASSWORD)
const fs = require("fs");
const crypto = require("crypto");
const msal = require("@azure/msal-node");

const TENANT = process.env.TENANT_ID;
const CLIENT = process.env.CLIENT_ID;
const DV = (process.env.DATAVERSE_URL || "").replace(/\/$/, "");
const API = DV + "/api/data/v9.2/";

let cca = null; // cached MSAL client (holds the in-memory token cache)

// --- turn a PEM blob into MSAL cert material (resilient to mangled newlines) ---
function _pemNormalize(raw) {
  return String(raw).replace(/\r/g, "").replace(/\\n/g, "\n");   // strip CR, unescape literal \n
}
function _pemBlock(pem, type) {
  // matches PRIVATE KEY / RSA PRIVATE KEY / CERTIFICATE, then rebuilds a clean block
  const re = new RegExp("-----BEGIN ([A-Z0-9 ]*" + type + ")-----([\\s\\S]*?)-----END \\1-----");
  const m = pem.match(re);
  if (!m) return null;
  const body = (m[2].match(/[A-Za-z0-9+/=]+/g) || []).join("");   // base64 chars only
  const wrapped = (body.match(/.{1,64}/g) || []).join("\n");      // rewrap at 64 cols
  return "-----BEGIN " + m[1] + "-----\n" + wrapped + "\n-----END " + m[1] + "-----\n";
}
function fromPem(pemRaw) {
  const pem = _pemNormalize(pemRaw);
  const keyPem = _pemBlock(pem, "PRIVATE KEY");
  const certPem = _pemBlock(pem, "CERTIFICATE");
  if (!keyPem || !certPem) throw new Error("Certificate PEM must contain both a private key and a certificate.");
  const x509 = new crypto.X509Certificate(certPem);
  return {
    privateKey: keyPem,
    thumbprint: x509.fingerprint.replace(/:/g, ""),               // SHA-1 hex
    x5c: certPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "") // base64 DER (leaf)
  };
}

// --- parse a PKCS#12 (DER as a binary string) into MSAL cert material ---
function fromP12Binary(derBinary, password) {
  const forge = require("node-forge");
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(derBinary), false, password || "");
  const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]
              || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0];
  if (!keyBag) throw new Error("PKCS#12 contained no private key.");
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0];
  const pem = forge.pki.privateKeyToPem(keyBag.key) + "\n" + forge.pki.certificateToPem(certBag.cert);
  return fromPem(pem);
}

// --- Key Vault: read the certificate secret via managed identity.
//     Handles BOTH a PEM secret and a base64 PKCS#12 secret (the default when a
//     .pfx certificate is imported into Key Vault). ---
async function fromKeyVault() {
  const { SecretClient } = require("@azure/keyvault-secrets");
  const { DefaultAzureCredential } = require("@azure/identity");
  if (!process.env.KEY_VAULT_URL || !process.env.CERT_NAME)
    throw new Error("KEY_VAULT_URL and CERT_NAME app settings are required for CERT_SOURCE=keyvault.");
  const client = new SecretClient(process.env.KEY_VAULT_URL, new DefaultAzureCredential());
  const secret = await client.getSecret(process.env.CERT_NAME);
  const val = secret.value || "";
  const ct = (secret.properties && secret.properties.contentType) || "";
  if (/pkcs12/i.test(ct) || !/-----BEGIN/.test(val)) {  // base64 PKCS#12
    return fromP12Binary(Buffer.from(val, "base64").toString("binary"), process.env.CERT_PASSWORD || "");
  }
  return fromPem(val);
}

// --- Function App certificate store: parse the loaded PKCS#12 (.p12) ---
function fromFileStore() {
  const thumb = (process.env.CERT_THUMBPRINT || "").replace(/:/g, "").toUpperCase();
  const path = process.env.CERT_P12_PATH || ("/var/ssl/private/" + thumb + ".p12");
  return fromP12Binary(fs.readFileSync(path, "binary"), process.env.CERT_PASSWORD || "");
}

async function loadCert() {
  return (process.env.CERT_SOURCE === "filestore") ? fromFileStore() : await fromKeyVault();
}

async function getClient() {
  if (cca) return cca;
  const cert = await loadCert();
  cca = new msal.ConfidentialClientApplication({
    auth: {
      clientId: CLIENT,
      authority: "https://login.microsoftonline.com/" + TENANT,
      clientCertificate: { thumbprint: cert.thumbprint, privateKey: cert.privateKey, x5c: cert.x5c }
    }
  });
  return cca;
}

async function getToken() {
  const client = await getClient();
  const r = await client.acquireTokenByClientCredential({ scopes: [DV + "/.default"] }); // MSAL caches/refreshes
  return r.accessToken;
}

async function dv(method, path, payload) {
  const token = await getToken();
  return fetch(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Prefer: "return=representation"
    },
    body: payload ? JSON.stringify(payload) : undefined
  });
}

// Reads the user that SWA/Easy Auth authenticated (confidential-not-anonymous identity).
function principal(req) {
  try {
    const hs = req && req.headers;
    const h = hs && typeof hs.get === "function"
      ? hs.get("x-ms-client-principal")          // v4: Headers object
      : (hs && hs["x-ms-client-principal"]);      // v3: plain object
    if (!h) return null;
    return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  } catch { return null; }
}

module.exports = { dv, getToken, principal, API, DV };
