const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || 'sql100.infinityfree.com',
  port: 3306,
  user: process.env.DB_USER || 'if0_41601927',
  password: process.env.DB_PASS || 'Phuonguyen2409',
  database: process.env.DB_NAME || 'if0_41601927_chuba_cfmobile',
  connectTimeout: 10000,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  // Doc key tu nhieu nguon: GET query, POST body (plain), POST body (base64 JSON)
  let key = '';
  let device = '';

  // 1. Thu GET query
  if (req.query.key) {
    key = req.query.key.trim();
    device = (req.query.device || '').trim();
  }

  // 2. Thu POST body
  if (!key && req.body) {
    try {
      // POST body co the la: token=BASE64_DATA
      let bodyStr = '';
      if (typeof req.body === 'string') {
        bodyStr = req.body;
      } else if (typeof req.body === 'object') {
        // Da duoc parse
        if (req.body.token) {
          // Decode base64 -> JSON -> data -> base64 -> JSON
          try {
            const outerJson = JSON.parse(Buffer.from(req.body.token, 'base64').toString('utf8'));
            if (outerJson.data) {
              const innerJson = JSON.parse(Buffer.from(outerJson.data, 'base64').toString('utf8'));
              // Tim key trong innerJson - thu nhieu field names
              key = innerJson.key || innerJson.Key || innerJson.k || innerJson.license || '';
              device = innerJson.device_id || innerJson.deviceId || innerJson.device || '';
            }
          } catch(e) {
            // Thu parse truc tiep
            key = req.body.key || req.body.Key || '';
            device = req.body.device_id || req.body.device || '';
          }
        } else {
          key = req.body.key || req.body.Key || '';
          device = req.body.device_id || req.body.device || '';
        }
      }
      
      // Thu parse raw body string
      if (!key && bodyStr) {
        // Format: token=BASE64
        const tokenMatch = bodyStr.match(/token=([^&]+)/);
        if (tokenMatch) {
          try {
            const decoded = Buffer.from(decodeURIComponent(tokenMatch[1]), 'base64').toString('utf8');
            const outerJson = JSON.parse(decoded);
            if (outerJson.data) {
              const innerJson = JSON.parse(Buffer.from(outerJson.data, 'base64').toString('utf8'));
              key = innerJson.key || innerJson.Key || innerJson.k || '';
              device = innerJson.device_id || innerJson.deviceId || '';
            }
          } catch(e) {}
        }
        
        // Thu parse JSON truc tiep
        if (!key) {
          try {
            const json = JSON.parse(bodyStr);
            key = json.key || json.Key || '';
            device = json.device_id || json.device || '';
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  // Log de debug
  console.log('Request - key:', key, 'device:', device, 'ip:', ip);
  console.log('Body:', JSON.stringify(req.body));

  if (!key) {
    return res.status(200).json({status: 'error', message: 'Key không được để trống'});
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
      return res.status(200).json({status: 'error', message: 'Key không hợp lệ hoặc đã bị vô hiệu hóa'});
    }

    const row = rows[0];

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await conn.end();
      return res.status(200).json({status: 'error', message: 'Key đã hết hạn'});
    }

    if (row.key_type === 'daily' && row.device_id) {
      await conn.end();
      return res.status(200).json({status: 'error', message: 'Key này đã được sử dụng rồi'});
    }

    if (!row.device_id) {
      await conn.execute(
        "UPDATE license_keys SET device_id = ?, last_used = NOW(), given_ip = ? WHERE id = ?",
        [device || 'unknown', ip, row.id]
      );
    } else if (row.device_id !== device && device) {
      await conn.end();
      return res.status(200).json({status: 'error', message: 'Key đã được sử dụng trên thiết bị khác'});
    } else {
      await conn.execute("UPDATE license_keys SET last_used = NOW() WHERE id = ?", [row.id]);
    }

    try {
      await conn.execute(
        "INSERT INTO usage_logs (key_id, device_id, ip, created_at) VALUES (?, ?, ?, NOW())",
        [row.id, device || 'unknown', ip]
      );
    } catch(e) {}

    await conn.end();
    
    // Tra ve JSON format - thu nhieu format de app nhan duoc
    // Format 1: {"status": "success", "data": "..."}
    // Format 2: {"trang_thai": "thanh_cong", ...}
    // Vi khong biet format chinh xac, tra ve nhieu field
    return res.status(200).json({
      status: 'success',
      trang_thai: 'thanh_cong', 
      message: 'OK',
      data: '',
      lib: '',
      key: key,
      ngay_het_han: row.expires_at || '',
    });

  } catch (err) {
    if (conn) try { await conn.end(); } catch(e) {}
    console.error('DB Error:', err.message);
    return res.status(200).json({status: 'error', message: 'Loi ket noi server'});
  }
};
