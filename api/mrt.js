/**
 * MovieRecapTool License Bypass Endpoint
 * URL: https://fcmobile-api.vercel.app/api/mrt
 *
 * App gửi POST với body: { license_key, hwid }
 * App verify JWT với RSA public key hardcoded trong exe.
 *
 * Response cần có:
 *   - success: true
 *   - valid: true
 *   - activated: true
 *   - token: <JWT signed với private key tương ứng public key trong exe>
 *
 * RSA Public Key trong exe (dùng để verify JWT):
 * -----BEGIN PUBLIC KEY-----
 * MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4Eb5bsHwwQ6+MuZZ4GXI
 * kvr9hrcLbLL/hgHCOcRK4Y2QRb/2pt1YjWavZ+8ck9XZfivBUoJdWYCKCpYBPyGd
 * OrSb9bXKG6qf/yjNXbwAYOPJHfOYifUcZJ3szt1QfHgm3snDM70LdYD7HpHcuPI1
 * B/qPnX0GlViNmq+p74JDWdfG/lALpifByHmThmfxfZPeAvFCP6ZOTOXbHUR46QM7
 * hkT39RE75ER4V0fbzJNrZuMIB891XMjuuYLkb8fJzdzD3NdN3KH84sXU9plU++fY
 * 6Rms6IKyB+2zUTMPMqrkEDs325JTkm8mjzVlH6qV2Xa2n05S2D+XDTeE37Od8urM
 * CQIDAQAB
 * -----END PUBLIC KEY-----
 *
 * NOTE: Ta KHÔNG có private key tương ứng.
 * Nhưng ta đã patch exe: T.F -> T.T tại 3 offsets (sig/hwid/expiry check)
 * Nên JWT verify result bị bypass - app accept mọi JWT.
 * Ta chỉ cần trả về token field với bất kỳ JWT nào.
 */

const crypto = require('crypto');

// Generate a temp RSA keypair for signing (app won't verify it properly due to patch)
// In production: pre-generate and store these
let _signKey = null;
let _signKeyGenerated = false;

function getSignKey() {
  if (!_signKey && !_signKeyGenerated) {
    _signKeyGenerated = true;
    try {
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      _signKey = privateKey;
    } catch(e) {
      console.error('Key gen error:', e.message);
    }
  }
  return _signKey;
}

function b64url(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
  return buf.toString('base64url');
}

function makeJWT(payload) {
  const key = getSignKey();
  if (!key) return 'dummy.jwt.token';
  
  const header  = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body    = b64url(Buffer.from(JSON.stringify(payload)));
  const message = `${header}.${body}`;
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  const sig = sign.sign(key).toString('base64url');
  
  return `${message}.${sig}`;
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

  const license_key = (body.license_key || body.key || 'MR-BYPASS').trim();
  const hwid        = (body.hwid || '').trim();
  const FAR         = Math.floor(Date.now() / 1000) + (365 * 24 * 3600 * 100); // ~100 years

  console.log(`[MRT] license_key=${license_key} hwid=${hwid.substring(0,12)}...`);

  // Build JWT payload
  const jwtPayload = {
    license_key,
    hwid,
    status:     'active',
    plan:       'lifetime',
    days_left:  36500,
    expires_at: FAR,
    exp:        FAR,
    iat:        Math.floor(Date.now() / 1000),
    valid:      true,
    activated:  true,
  };

  const token = makeJWT(jwtPayload);

  return res.status(200).json({
    success:     true,
    valid:       true,
    activated:   true,
    status:      'active',
    message:     'Kich hoat thanh cong!',
    license_key,
    hwid,
    plan:        'lifetime',
    days_left:   36500,
    expires_at:  FAR,
    expiry_date: '2126-01-01',
    token,
    data: jwtPayload,
  });
};
