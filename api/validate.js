const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_gjErsVQC51po@ep-dawn-star-a1cdfi8b.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  const hwid = (body.hwid || '').trim();
  const key = (body.key || '').trim();
  const expected_type = body.expected_type || 'app';

  if (!key) {
    return res.status(200).json({ valid: false, message: 'Key không được để trống', days_left: 0, hours_left: 0, type: expected_type });
  }

  let client;
  try {
    client = await pool.connect();

    const result = await client.query(
      "SELECT * FROM license_keys WHERE key = $1 AND status = 'active' LIMIT 1", [key]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(200).json({ valid: false, message: 'Key không hợp lệ hoặc đã bị vô hiệu hóa', days_left: 0, hours_left: 0, type: expected_type });
    }

    const row = result.rows[0];
    let days_left = 9999, hours_left = 0;

    if (row.expires_at) {
      const now = new Date(), exp = new Date(row.expires_at);
      if (exp < now) {
        client.release();
        return res.status(200).json({ valid: false, message: 'Key đã hết hạn', days_left: 0, hours_left: 0, type: expected_type });
      }
      const diff = exp - now;
      days_left = Math.floor(diff / 86400000);
      hours_left = Math.floor((diff % 86400000) / 3600000);
    }

    const key_type = row.key_type || 'app';

    if (!row.device_id && hwid) {
      await client.query("UPDATE license_keys SET device_id = $1, last_used = NOW() WHERE id = $2", [hwid, row.id]);
    } else if (row.device_id && hwid && row.device_id !== hwid) {
      client.release();
      return res.status(200).json({ valid: false, message: 'Key đã được sử dụng trên thiết bị khác', days_left: 0, hours_left: 0, type: key_type });
    } else {
      await client.query("UPDATE license_keys SET last_used = NOW() WHERE id = $1", [row.id]);
    }

    try {
      await client.query("INSERT INTO usage_logs (key_id, device_id, ip) VALUES ($1, $2, $3)",
        [row.id, hwid || 'unknown', req.headers['x-forwarded-for'] || '']);
    } catch(e) {}

    client.release();
    return res.status(200).json({ valid: true, message: 'Kích hoạt thành công!', days_left, hours_left, type: key_type });

  } catch (err) {
    if (client) try { client.release(); } catch(e) {}
    return res.status(200).json({ valid: false, message: 'Loi ket noi: ' + err.message, days_left: 0, hours_left: 0, type: expected_type });
  }
};
