/**
 * RECAP 2.0 License Validation Endpoint
 * URL: https://fcmobile-api.vercel.app/api/recap_license
 * 
 * Replaces: https://n8n.kentjuno.com/webhook/validate-license
 * 
 * The app sends POST with body: { license_key, hwid }
 * App verifies JWT with RSA public key patched in licensing_manager.pyd
 * This server signs JWT with the matching private key.
 *
 * JWT Claims checked by app:
 *   - hwid: must match current machine (checked in validate_claims_for_current_machine)
 *   - exp: unix timestamp (must not be expired)
 *   - expires_at: ISO datetime string (subscription expiry)  
 *   - status: 'active' or similar
 *   - plan: 'full' or 'trial'
 *   - license_key: the key submitted
 *
 * Response format (n8n webhook format):
 *   { success: true, token: "<JWT>", ... }
 */

const crypto = require('crypto');

// RSA Private Key (PKCS8 PEM) - matches patched public key in licensing_manager.pyd
const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEuwIBADANBgkqhkiG9w0BAQEFAASCBKUwggShAgEAAoIBAQDHbVoGKvhEqFem
T8QbpgSEvN+w27Ed7Feez5AA8dcbpyG0t1tJ9W9pqkSzOoea4Ofa08VVN/NJaOrF
8+U/jdd0Xf8sQVtyOgQKkiySVm5/K8XEhib4F0hsTN5F/3r9WtzFzOXPw2TdTxDH
udvL9A0cMvig2pTZRu/SAb2/YR0Lrjxn0B1WItmigQ0J78FWMeofX2DxEsKDZyFy
eovUfWBJL2bo8b+PF/hlA72yp6V6wEVXNB9mSBXVWsxs4UUHOU2qkwBALkahTUvG
cAl2h9BqGXSJ3bB6AgpxGgGGXtxX2km7i4FrTADj2r2lpLWIXjXoYGhgGYLV5wwy
oKMD+GspAgMBAAECgf8MljOw6dRG1TmabekiDbVQVzy1hW5LaOqyGYqqyrvRpg0y
qaKO2RcbxwdI2+VUdiqcQScjeqjshzmv1IWTyLJwFDwL/Xm4Se2Yry1nIJYpbRnU
eVlzhzJBVnWYYhyXdEl62tC36EdCl/9LSyDRnT+71sxjMIgb8u+/v+ioaO4vAUi2
fS2pqp40jqFQVI20O/ROoiawed2RhKEuCCOC2v1zvVHqJKg5xp9sflsbestMZZxX
H2LyrrKM5iXSQisB/h0AUM7Qsc20nCDBqoETxmY3dOR/8OnxWXyz3jLGQDFXkPcw
xQvw/D7hDPe+lQ57/XCYIed9PPnrFmPwrlxrfVcCgYEA65aRH+7ro86cVEZ0T6F8
CeIwXbWwFqCw83NDWQFZYyb2382NKWsYyDG5RpS/Dyw7f3QB16ZqMSqOx0ZiAkFp
U1lRY+6oVhHOHmUUxpTL8eqilUVkuu7w4Ajjes9n9SvcF3YRg5r5D9gvJbT4jikr
lYZ/bOxZOCDeep7fHNTTGzcCgYEA2LS4aV1NdUgqZRPDbv3aN5gJQdW/rChhpsq9
KqgKywIK3thePZp6Q7ewDvdGt1cac6sVnjUP5VHNATmsCC92X/1pGRsB8Srb/xjf
inL1wcOemMTiLp7gdyw34OsZ7tEuY3yRCeEuOrVeXae2y0ShwmzHnKGRofleZpl1
x6ZjnJ8CgYBlVP0VLDIk4jCxuyA6RC5THfxJwmV8Rh/2hyR3uzHUiST0/Lf0EcG2
ElUr+7z2bMMmviIwvL6+aRzCsA5mA/amyCtO/Y9gfgYXYsj95XCXnKHT7OY31aC7
7HbUEzQW64eee8VqwxTP8N/OqzmiBClgBlr24e46S0EGoyE6iHxJHwKBgQDCXBwF
zDv7k5UKgNZIxv8f24l59ZbqdnFW4gEVsA+2Egfj5JVplRJRh/8s/RT8vO+pjGlg
MuEl4N8IWUx1LvRxlVvcu39baQBVZF6h0weeGLA2/maKP868s/kODm585jo/2mpP
PRp0Z1TSlOh6mPyn316MmdB/QKQtSzf6r74pqwKBgEzOgNlDeMPVUUodEfAoiVu1
2Pf5nWy17gMb+jb/GhwkLMk+q4ksNk3BOazZjkanK/JYKerbLTuSmJuqZvxXqA/U
G1O6t2qfimHHdYljVCz8xhjNQCH4f4JWjF5nZREWtLYDdEMfcyBbMRB8+S8i7n9O
+Aev1sYKX9Rn5DjSJJnu
-----END PRIVATE KEY-----`;

function b64url(buf) {
  return buf.toString('base64url');
}

function signJWT(payload) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body   = b64url(Buffer.from(JSON.stringify(payload)));
  const message = `${header}.${body}`;
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  const sig = sign.sign(PRIVATE_KEY_PEM).toString('base64url');
  
  return `${message}.${sig}`;
}

// Validate key format: MR-XXXX-XXXX-XXXX
function isValidKeyFormat(key) {
  return /^MR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {}
  }

  const license_key = ((body.license_key || body.key || '')).trim().toUpperCase();
  const hwid        = (body.hwid || '').trim();

  console.log(`[RECAP2] activate: key=${license_key} hwid=${hwid.substring(0,12)}...`);

  // Accept any properly formatted key
  if (!license_key) {
    return res.status(200).json({
      success: false,
      valid: false,
      message: 'Key không được để trống'
    });
  }

  // Normalize key (accept with or without MR- prefix)
  let normalized_key = license_key;
  if (!normalized_key.startsWith('MR-') && normalized_key.length >= 12) {
    // Try to format as MR-XXXX-XXXX-XXXX
    const clean = normalized_key.replace(/-/g, '');
    if (clean.length === 12) {
      normalized_key = `MR-${clean.substring(0,4)}-${clean.substring(4,8)}-${clean.substring(8,12)}`;
    }
  }

  // 100 years from now
  const now_sec    = Math.floor(Date.now() / 1000);
  const far_future = now_sec + (100 * 365 * 24 * 3600);
  const exp_date   = new Date(far_future * 1000).toISOString().replace('T', ' ').substring(0, 19);

  // Build JWT payload matching what RECAP 2.0 expects
  const jwtPayload = {
    // Core identity
    license_key:  normalized_key,
    hwid:         hwid,
    // Status/plan
    status:       'active',
    plan:         'full',       // 'full' = Recap enabled (not trial)
    // Timestamps
    iat:          now_sec,
    exp:          far_future,   // JWT standard expiry (100 years)
    expires_at:   exp_date,     // App-specific subscription expiry (datetime string)
    // Extra fields app might check
    activated:    true,
    valid:        true,
    days_left:    36500,
    subscription_expires_at: exp_date,
  };

  let token;
  try {
    token = signJWT(jwtPayload);
  } catch (err) {
    console.error('[RECAP2] JWT sign error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }

  const response = {
    success:      true,
    valid:        true,
    activated:    true,
    status:       'active',
    plan:         'full',
    message:      'Kich hoat thanh cong!',
    license_key:  normalized_key,
    hwid:         hwid,
    days_left:    36500,
    expires_at:   exp_date,
    expiry_date:  '2126-01-01',
    token:        token,
    // n8n webhook format also wraps in data
    data: jwtPayload,
  };

  console.log(`[RECAP2] Success: key=${normalized_key} plan=full exp=${exp_date}`);
  return res.status(200).json(response);
};
