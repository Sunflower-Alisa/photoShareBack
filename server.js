const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const morgan = require('morgan');
const baiduPanService = require('./service/baiduPanService');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

// 配置中间件
app.use(cors());
app.use(bodyParser.json());
app.use(morgan('dev'));


// 获取授权URL
app.get('/auth/baidu', (req, res) => {
  const authUrl = `https://openapi.baidu.com/oauth/2.0/authorize?response_type=code&client_id=${baiduPanService.clientId}&redirect_uri=${encodeURIComponent(baiduPanService.redirectUri)}&scope=basic,netdisk&display=page`;
  res.redirect(authUrl);
});

// 授权回调
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    const tokenResponse = await axios.get('https://openapi.baidu.com/oauth/2.0/token', {
      params: {
        grant_type: 'authorization_code',
        code,
        client_id: baiduPanService.clientId,
        client_secret: baiduPanService.clientSecret,
        redirect_uri: baiduPanService.redirectUri
      }
    });
    
    baiduPanService.accessToken = tokenResponse.data.access_token;
    baiduPanService.refreshToken = tokenResponse.data.refresh_token;
    
    res.send('授权成功！您现在可以上传文件了。');
  } catch (error) {
    console.error('授权失败:', error.response.data);
    res.status(500).send('授权失败');
  }
});

// MySQL数据库连接
const pool = mysql.createPool({
  host: 'YOUR_MYSQL_HOST',
  user: 'YOUR_MYSQL_USER',
  password: 'YOUR_MYSQL_PASSWORD',
  database: 'image_sharing',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// JWT密钥
const JWT_SECRET = 'YOUR_JWT_SECRET';

// 用户认证中间件
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ code: 401, msg: '未授权' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
    if (!users.length) return res.status(401).json({ code: 401, msg: '用户不存在' });
    
    req.user = users[0];
    next();
  } catch (err) {
    res.status(401).json({ code: 401, msg: '无效的token' });
  }
};

// 路由定义

// 用户登录
app.post('/api/login', async (req, res) => {
  const { code } = req.body; // 微信登录code
  
  // 这里应该调用微信接口获取openid
  // 模拟实现
  const openid = `mock_openid_${Math.random().toString(36).substr(2)}`;
  
  // 检查用户是否存在
  const [users] = await pool.query('SELECT * FROM users WHERE openid = ?', [openid]);
  let user;
  
  if (users.length) {
    user = users[0];
  } else {
    // 新用户注册
    const [result] = await pool.query(
      'INSERT INTO users (openid, created_at) VALUES (?, NOW())',
      [openid]
    );
    user = { id: result.insertId, openid };
  }
  
  // 生成JWT
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  
  res.json({ code: 0, data: { token } });
});


// 上传图片
app.post('/api/upload', authenticate, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ code: 400, msg: '没有上传文件' });
  }
  

  if (!baiduPanService.accessToken) {
    return res.status(401).json({ error: '请先授权百度账号' });
  }

//   try {
//     // 上传到百度网盘
//     const fileStream = fs.createReadStream(req.file.path);
//     const uploadResult = await baiduPan.uploadFile({
//       file: fileStream,
//       filename: req.file.originalname,
//       path: '/apps/image_sharing/' // 百度网盘目录
//     });
    
//     // 保存到数据库
//     const [result] = await pool.query(
//       'INSERT INTO images (user_id, url, path, created_at) VALUES (?, ?, ?, NOW())',
//       [req.user.id, uploadResult.url, uploadResult.path]
//     );
    
//     // 删除临时文件
//     fs.unlinkSync(req.file.path);
    
//     res.json({ code: 0, data: { id: result.insertId, url: uploadResult.url } });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ code: 500, msg: '上传失败' });
//   }
// });
try {
  const { path: filePath, originalname } = req.file;
  
  // 1. 预上传 - 获取上传URL
  const preUploadResponse = await axios.post('https://pan.baidu.com/rest/2.0/pcs/file', null, {
    params: {
      method: 'precreate',
      access_token: baiduPanService.accessToken,
      path: `${baiduPanService.uploadDir}${originalname}`,
      size: req.file.size,
      isdir: 0,
      autoinit: 1,
      block_list: JSON.stringify([1]) // 简单文件直接整个上传
    }
  });
  
  const { uploadid, block_list } = preUploadResponse.data;
  
  // 2. 分片上传
  const uploadUrl = `https://d.pcs.baidu.com/rest/2.0/pcs/file`;
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('part', '1');
  form.append('uploadid', uploadid);
  form.append('type', 'tmpfile');
  
  const uploadResponse = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    params: {
      method: 'upload',
      access_token: baiduPanService.accessToken,
      path: `${baiduPanService.uploadDir}${originalname}`
    },
    onUploadProgress: (progressEvent) => {
      const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
      console.log(`上传进度: ${percent}%`);
      // 这里可以发送进度到前端，例如使用WebSocket
    }
  });
  
  // 3. 创建文件
  const createResponse = await axios.post('https://pan.baidu.com/rest/2.0/pcs/file', null, {
    params: {
      method: 'create',
      access_token: baiduPanService.accessToken,
      path: `${baiduPanService.uploadDir}${originalname}`,
      size: req.file.size,
      isdir: 0,
      uploadid,
      block_list: JSON.stringify(block_list)
    }
  });
  
  // 保存到数据库
  const [result] = await pool.query(
    'INSERT INTO images (user_id, url, path, created_at) VALUES (?, ?, ?, NOW())',
    [req.user.id, `${baiduPanService.uploadDir}${originalname}`, '']
  );
  // 清理临时文件
  await fse.remove(filePath);
  
  res.json({ 
    success: true,
    data: createResponse.data
  });
} catch (error) {
  console.error('上传失败:', error.response?.data || error.message);
  res.status(500).json({ 
    error: '上传失败',
    details: error.response?.data || error.message
  });
}
});

// 刷新Access Token
async function refreshAccessToken() {
  try {
    const response = await axios.get('https://openapi.baidu.com/oauth/2.0/token', {
      params: {
        grant_type: 'refresh_token',
        refresh_token: baiduPanService.refreshToken,
        client_id: baiduPanService.clientId,
        client_secret: baiduPanService.clientSecret
      }
    });
    
    baiduPanService.accessToken = response.data.access_token;
    baiduPanService.refreshToken = response.data.refresh_token;
    
    console.log('Access Token 刷新成功');
    return true;
  } catch (error) {
    console.error('刷新Token失败:', error.response?.data || error.message);
    return false;
  }
}

// 获取喜欢的图片列表
app.get('/api/images', async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    // 获取图片列表
    const [images] = await pool.query(
      `SELECT i.*, u.nickname, u.avatar, 
       (SELECT COUNT(*) FROM favorites WHERE image_id = i.id) AS favorite_count,
       (SELECT COUNT(*) > 0 FROM favorites WHERE image_id = i.id AND user_id = ?) AS favorited
       FROM images i
       LEFT JOIN users u ON i.user_id = u.id
       ORDER BY i.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user?.id || 0, parseInt(limit), parseInt(offset)]
    );
    
    res.json({ code: 0, data: images });
  } catch (err) {
    console.error(err);
    res.status(500).json({ code: 500, msg: '获取失败' });
  }
});

// 收藏/取消收藏
app.post('/api/images/:id/favorite', authenticate, async (req, res) => {
  const { id } = req.params;
  
  try {
    // 检查是否已收藏
    const [existing] = await pool.query(
      'SELECT * FROM favorites WHERE user_id = ? AND image_id = ?',
      [req.user.id, id]
    );
    
    if (existing.length) {
      await pool.query(
        'DELETE FROM favorites WHERE user_id = ? AND image_id = ?',
        [req.user.id, id]
      );
    } else {
      await pool.query(
        'INSERT INTO favorites (user_id, image_id, created_at) VALUES (?, ?, NOW())',
        [req.user.id, id]
      );
    }
    
    res.json({ code: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ code: 500, msg: '操作失败' });
  }
});

// 获取收藏列表
app.get('/api/favorites', authenticate, async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    const [favorites] = await pool.query(
      `SELECT i.*, u.nickname, u.avatar, 
       (SELECT COUNT(*) FROM favorites WHERE image_id = i.id) AS favorite_count,
       1 AS favorited
       FROM images i
       LEFT JOIN users u ON i.user_id = u.id
       JOIN favorites f ON i.id = f.image_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, parseInt(limit), parseInt(offset)]
    );
    

    res.json({ code: 0, data: favorites });
  } catch (err) {
    console.error(err);
    res.status(500).json({ code: 500, msg: '获取失败' });
  }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});