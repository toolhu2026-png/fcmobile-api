const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'sql100.infinityfree.com',
  port: 3306,
  user: 'if0_41601927',
  password: 'Phuonguyen2409',
  database: 'if0_41601927_chuba_cfmobile',
  connectTimeout: 10000,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Doc request body
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {}
  }

  const hwid = (body.hwid || '').trim();
  const key = (body.key || '').trim();
  const expected_type = body.expected_type || 'app';
  const app_version = body.app_version || '';

  console.log('validate request:', { hwid, key, expected_type, app_version });

  if (!key) {
    return res.status(200).json({
      valid: false,
      message: 'Key không được để trống',
      days_left: 0,
      hours_left: 0,
      type: expected_type
    });
  }

  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(
      "SELECT * FROM license_keys WHERE `key` = ? AND status = 'active' LIMIT 1",
      [key]
    );

    if (rows.length === 0) {
      await conn.end();
      return res.status(200).json({
        valid: false,
        message: 'Key không hợp lệ hoặc đã bị vô hiệu hóa',
        days_left: 0,
        hours_left: 0,
        type: expected_type
      });
    }

    const row = rows[0];

    // Check expiry
    let days_left = 9999;
    let hours_left = 0;
    if (row.expires_at) {
      const now = new Date();
      const exp = new Date(row.expires_at);
      if (exp < now) {
        await conn.end();
        return res.status(200).json({
          valid: false,
          message: 'Key đã hết hạn',
          days_left: 0,
          hours_left: 0,
          type: expected_type
        });
      }
      const diff_ms = exp - now;
      days_left = Math.floor(diff_ms / (1000 * 60 * 60 * 24));
      hours_left = Math.floor((diff_ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    }

    // Check key type vs expected_type
    const key_type = row.key_type || 'app';
    if (expected_type && expected_type !== key_type && key_type !== 'all') {
      // Allow if key_type is 'app' and expected is 'app', or 'sub' and expected is 'sub'
      // For simplicity, accept any key for any type
    }

    // Bind HWID if not bound
    if (!row.device_id && hwid) {
      await conn.execute(
        "UPDATE license_keys SET device_id = ?, last_used = NOW() WHERE id = ?",
        [hwid, row.id]
      );
    } else if (row.device_id && hwid && row.device_id !== hwid) {
      await conn.end();
      return res.status(200).json({
        valid: false,
        message: 'Key đã được sử dụng trên thiết bị khác',
        days_left: 0,
        hours_left: 0,
        type: key_type
      });
    } else {
      await conn.execute("UPDATE license_keys SET last_used = NOW() WHERE id = ?", [row.id]);
    }

    // Log usage
    try {
      await conn.execute(
        "INSERT INTO usage_logs (key_id, device_id, ip, created_at) VALUES (?, ?, ?, NOW())",
        [row.id, hwid || 'unknown', req.headers['x-forwarded-for'] || '']
      );
    } catch(e) {}

    await conn.end();

    return res.status(200).json({
      valid: true,
      message: 'Kích hoạt thành công!',
      days_left: days_left,
      hours_left: hours_left,
      type: key_type
    });

  } catch (err) {
    if (conn) try { await conn.end(); } catch(e) {}
    console.error('DB Error:', err.message);
    return res.status(200).json({
      valid: false,
      message: 'Lỗi kết nối server',
      days_left: 0,
      hours_left: 0,
      type: expected_type
    });
  }
};
