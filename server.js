const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const morgan = require('morgan');
// const baiduPanService = require('./service/baiduPanService');
const aliyunPanService = require('./service/aliyunPanService');
const path = require('path');
const CryptoJS = require('crypto-js');
const cloudbase = require("@cloudbase/node-sdk");

// const app = express();
const app = cloudbase.init({
  env: "photo-8gpigsbh9518cc2a",
});
const upload = multer({ dest: 'uploads/' });

// 配置中间件
app.use(cors());
app.use(bodyParser.json());
app.use(morgan('dev'));


// // 获取授权URL
// app.get('/auth/baidu', (req, res) => {
//   const authUrl = `https://openapi.baidu.com/oauth/2.0/authorize?response_type=code&client_id=${aliyunPanService.clientId}&redirect_uri=${encodeURIComponent(aliyunPanService.redirectUri)}&scope=basic,netdisk&display=page`;
//   res.redirect(authUrl);
// });

// // 授权回调
// app.get('/auth/callback', async (req, res) => {
//   const { code } = req.query;

//   try {
//     const tokenResponse = await axios.get('https://openapi.baidu.com/oauth/2.0/token', {
//       params: {
//         grant_type: 'authorization_code',
//         code,
//         client_id: aliyunPanService.clientId,
//         client_secret: aliyunPanService.clientSecret,
//         redirect_uri: aliyunPanService.redirectUri
//       }
//     });

//     aliyunPanService.accessToken = tokenResponse.data.access_token;
//     aliyunPanService.refreshToken = tokenResponse.data.refresh_token;

//     res.send('授权成功！您现在可以上传文件了。');
//   } catch (error) {
//     console.error('授权失败:', error.response.data);
//     res.status(500).send('授权失败');
//   }
// });


const db = app.database();

const APPID = 'wxc6634cd42aa9fc03';
const APPSECRET = 'a56707a4d26ce7b3237427c6e5f2dc63';
// JWT密钥
const JWT_SECRET = 'shiguangcanglyk7925';

// 用户认证中间件
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ code: 401, msg: '未授权' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = await db
      .collection("users")
      .where({
        id: decoded.userId
      })
      .get();
    // const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
    if (!users.length) return res.status(401).json({ code: 401, msg: '用户不存在' });

    req.user = users[0];
    next();
  } catch (err) {
    res.status(401).json({ code: 401, msg: '无效的token' });
  }
};

// 用户登录接口
app.post('/api/login', async (req, res) => {
  const { code } = req.body;

  try {
    // 向微信服务器请求 openid 和 session_key
    const response = await axios.get(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${APPSECRET}&js_code=${code}&grant_type=authorization_code`
    );

    const { openid, session_key } = response.data;

    // 生成JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    // 检查用户是否存在
    // const [users] = await pool.query('SELECT * FROM users WHERE openid = ?', [openid]);
    const users = await db
      .collection("users")
      .where({
        openid: openid
      })
      .get();

    let user;
    if (users.length) {
      user = users[0];
    } else {
      // 如果用户不存在，则创建新用户
      const result = await db.collection('users').add({
        openid,
        created_at: new Date()
      });
      user = { id: result.id, openid };
    }
    res.json({
      code: 200,
      data: { openid, token,user },
      message: '登录成功'
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '登录失败',
      error: error.message
    });
  }
});

// 保存用户信息接口
router.post('/api/saveUserInfo', async (req, res) => {
  try {
    const { code, nickName, avatarUrl } = req.body;
    
    // 1. 获取openid和session_key
    const session = await getWxUserSession(code);
    
    // 2. 保存用户信息到数据库
    const user = await saveUserToDB({
      openid: session.openid,
      nickname: nickName,
      avatar: avatarUrl
    });
    
    res.json({
      code: 0,
      data: user,
      message: '用户信息保存成功'
    });
  } catch (error) {
    console.error('保存用户信息失败:', error.message);
    res.status(500).json({
      code: -1,
      message: error.message
    });
  }
});

// 保存用户信息到数据库
async function saveUserToDB(userInfo) {
  // 这里实现你的数据库保存逻辑
  // 示例代码：
  const user = {
    openid: userInfo.openid,
    nickname: userInfo.nickname,
    avatar: userInfo.avatar,
    created_at: new Date()
  };
  
  const res = await db.collection('users')
    .update({
      nickname: userInfo.nickname,
      avatar: userInfo.avatar,
      created_at: new Date()
    }).where({
      openid: userInfo.openid
    }).get();
  
  return res;
}


// 解密用户信息接口
app.post('/api/userinfo', async (req, res) => {
  const { encryptedData, iv, token } = req.body;

  try {
    // 根据 token 获取 session_key（实际应从数据库或缓存中读取）
    const session_key = '从缓存或数据库获取的session_key';

    // 解密数据
    const decoded = decryptData(encryptedData, iv, session_key);
    const userInfo = JSON.parse(decoded);

    res.json({
      code: 200,
      data: userInfo,
      message: '获取用户信息成功'
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '解密失败',
      error: error.message
    });
  }
});

// 解密函数
function decryptData(encryptedData, iv, sessionKey) {
  const key = CryptoJS.enc.Base64.parse(sessionKey);
  const ivParsed = CryptoJS.enc.Base64.parse(iv);
  const encryptedDataParsed = CryptoJS.enc.Base64.parse(encryptedData);

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: encryptedDataParsed },
    key,
    { iv: ivParsed, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  );

  return decrypted.toString(CryptoJS.enc.Utf8);
}

// 上传图片
app.post('/api/upload', authenticate, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ code: 400, msg: '没有上传文件' });
  }


  if (!aliyunPanService.accessToken) {
    return res.status(401).json({ error: '请先授权百度账号' });
  }

  try {
    const { path: filePath, originalname } = req.file;

    // 1. 预上传 - 获取上传URL
    const preUploadResponse = await axios.post('https://pan.baidu.com/rest/2.0/pcs/file', null, {
      params: {
        method: 'precreate',
        access_token: aliyunPanService.accessToken,
        path: `${aliyunPanService.uploadDir}${originalname}`,
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
        access_token: aliyunPanService.accessToken,
        path: `${aliyunPanService.uploadDir}${originalname}`
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
        access_token: aliyunPanService.accessToken,
        path: `${aliyunPanService.uploadDir}${originalname}`,
        size: req.file.size,
        isdir: 0,
        uploadid,
        block_list: JSON.stringify(block_list)
      }
    });

    // 保存到数据库
    const [result] = await pool.query(
      'INSERT INTO images (user_id, url, path, created_at) VALUES (?, ?, ?, NOW())',
      [req.user.id, `${aliyunPanService.uploadDir}${originalname}`, '']
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

// // 刷新Access Token
// async function refreshAccessToken() {
//   try {
//     const response = await axios.get('https://openapi.baidu.com/oauth/2.0/token', {
//       params: {
//         grant_type: 'refresh_token',
//         refresh_token: aliyunPanService.refreshToken,
//         client_id: aliyunPanService.clientId,
//         client_secret: aliyunPanService.clientSecret
//       }
//     });

//     aliyunPanService.accessToken = response.data.access_token;
//     aliyunPanService.refreshToken = response.data.refresh_token;

//     console.log('Access Token 刷新成功');
//     return true;
//   } catch (error) {
//     console.error('刷新Token失败:', error.response?.data || error.message);
//     return false;
//   }
// }

// 获取图片列表
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

    // const fileId = '你的文件ID'; // 替换为你要获取缩略图的文件ID
    thumbnailImageUrl=[];
    images.forEach(async element => {
          // 方法1：直接获取缩略图URL
        const thumbnailUrl = await aliyunPanService.getThumbnailUrl(element, 400, 400);
        console.log('缩略图URL:', thumbnailUrl);
        element.thumbnailImageUrl = thumbnailUrl;
        
        // // 方法2：下载缩略图到本地
        // await aliyunPanService.downloadThumbnail(thumbnailUrl, './thumbnail.jpg');
        
        // // 方法3：获取完整文件信息（可能包含缩略图信息）
        // const fileInfo = await aliyunPanService.getFileInfo(fileId);
        // console.log('文件信息:', fileInfo);
    });
  
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

    thumbnailImageUrl=[];
    favorites.forEach(async element => {
          // 方法1：直接获取缩略图URL
        const thumbnailUrl = await aliyunPanService.getThumbnailUrl(element, 400, 400);
        console.log('缩略图URL:', thumbnailUrl);
        element.thumbnailImageUrl = thumbnailUrl;
        
        // // 方法2：下载缩略图到本地
        // await aliyunPanService.downloadThumbnail(thumbnailUrl, './thumbnail.jpg');
        
        // // 方法3：获取完整文件信息（可能包含缩略图信息）
        // const fileInfo = await aliyunPanService.getFileInfo(fileId);
        // console.log('文件信息:', fileInfo);
    });

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