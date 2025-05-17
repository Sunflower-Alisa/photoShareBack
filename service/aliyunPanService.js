const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');


class AliyunPanService {
    constructor() {
        this.config = {
            clientId: '你的ClientID',
            clientSecret: '你的ClientSecret',
            refreshToken: '你的RefreshToken', // 用于获取access_token
            uploadUrl: 'https://api.aliyundrive.com/v2/file/create_with_proof',
            tokenUrl: 'https://api.aliyundrive.com/v2/account/token',

            apiUrl: 'https://api.aliyundrive.com/v2/file/get',
            thumbnailUrl: 'https://api.aliyundrive.com/v2/file/get_thumbnail_url',
            // clientId: 'YOUR_CLIENT_ID',
            // clientSecret: 'YOUR_CLIENT_SECRET',
            accessToken: '',
            // refreshToken: 'YOUR_REFRESH_TOKEN',
            // apiBaseUrl: 'https://pan.baidu.com/rest/2.0',
            // redirectUri: 'YOUR_REDIRECT_URI',
            uploadDir: '/apps/拾光舱/' // 网盘上传目录
        };
    }

    /**
     * 获取文件信息（包含缩略图URL）
     * @param {string} fileId 文件ID
     * @returns {Promise<Object>} 文件信息
     */
    async  getFileInfo(fileId) {
    try {
        const response = await axios.post(
        this.config.apiUrl,
        {
            file_id: fileId,
            drive_id: '默认是当前用户的drive_id，可以不传'
        },
        {
            headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json'
            }
        }
        );
        
        return response.data;
    } catch (error) {
        console.error('获取文件信息失败:', error.response?.data || error.message);
        throw error;
    }
    }

    /**
     * 获取缩略图URL
     * @param {string} fileId 文件ID
     * @param {number} [width=200] 缩略图宽度
     * @param {number} [height=200] 缩略图高度
     * @returns {Promise<string>} 缩略图URL
     */
    async getThumbnailUrl(fileId, width = 200, height = 200) {
    try {
        const response = await axios.post(
        this.config.thumbnailUrl,
        {
            file_id: fileId,
            width,
            height,
            drive_id: '默认是当前用户的drive_id，可以不传'
        },
        {
            headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json'
            }
        }
        );
        
        return response.data.url;
    } catch (error) {
        console.error('获取缩略图URL失败:', error.response?.data || error.message);
        throw error;
    }
    }

    /**
     * 下载缩略图
     * @param {string} thumbnailUrl 缩略图URL
     * @param {string} [outputPath] 保存路径（可选）
     * @returns {Promise<Buffer>} 缩略图数据
     */
    async downloadThumbnail(thumbnailUrl, outputPath) {
    try {
        const response = await axios.get(thumbnailUrl, {
        responseType: 'arraybuffer'
        });
        
        const thumbnailData = Buffer.from(response.data, 'binary');
        
        if (outputPath) {
        const fs = require('fs');
        fs.writeFileSync(outputPath, thumbnailData);
        console.log(`缩略图已保存到: ${outputPath}`);
        }
        
        return thumbnailData;
    } catch (error) {
        console.error('下载缩略图失败:', error.message);
        throw error;
    }
    }

// // 使用示例
// (async () => {
//   try {
//     const fileId = '你的文件ID'; // 替换为你要获取缩略图的文件ID
    
//     // 方法1：直接获取缩略图URL
//     const thumbnailUrl = await getThumbnailUrl(fileId, 400, 400);
//     console.log('缩略图URL:', thumbnailUrl);
    
//     // 方法2：下载缩略图到本地
//     await downloadThumbnail(thumbnailUrl, './thumbnail.jpg');
    
//     // 方法3：获取完整文件信息（可能包含缩略图信息）
//     const fileInfo = await getFileInfo(fileId);
//     console.log('文件信息:', fileInfo);
    
//   } catch (error) {
//     console.error('操作失败:', error);
//   }
// })();

    // 获取访问令牌
    async getAccessToken() {
    try {
        const response = await axios.post(this.config.tokenUrl, {
        grant_type: 'refresh_token',
        refresh_token: this.config.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        });

        this.config.accessToken = response.data.access_token;
        return response.data.access_token;
    } catch (error) {
        console.error('获取access_token失败:', error.response?.data || error.message);
        throw error;
    }
    }

    // 上传图片到阿里云盘
    async  uploadImageToAliyunDrive(filePath, parentFolderId = 'root') {
    try {
        // 1. 获取access_token
        await getAccessToken();
        // 2. 准备文件信息
        const fileName = path.basename(filePath);
        const fileSize = fs.statSync(filePath).size;
        const fileContent = fs.readFileSync(filePath);
        
        // 3. 创建预上传请求
        const preUploadResponse = await axios.post(
        this.config.uploadUrl,
        {
            name: fileName,
            type: 'file',
            parent_file_id: parentFolderId,
            size: fileSize,
            check_name_mode: 'auto_rename', // 如果文件名冲突自动重命名
        },
        {
            headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
            },
        }
        );
        
        const { file_id, upload_id, part_info_list } = preUploadResponse.data;
        
        // 4. 上传文件内容
        const formData = new FormData();
        formData.append('file', fileContent, {
        filename: fileName,
        contentType: 'application/octet-stream',
        });
        
        const uploadResponse = await axios.post(
        part_info_list[0].upload_url, // 使用预上传返回的上传URL
        formData,
        {
            headers: {
            ...formData.getHeaders(),
            'Content-Length': fileSize,
            },
        }
        );
        
        // 5. 完成上传
        await axios.post(
        'https://api.aliyundrive.com/v2/file/complete',
        {
            file_id,
            upload_id,
        },
        {
            headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
            },
        }
        );
        
        console.log('文件上传成功:', fileName);
        return file_id;
    } catch (error) {
        console.error('上传文件失败:', error.response?.data || error.message);
        throw error;
    }
    }

// // 使用示例
// (async () => {
//   try {
//     const filePath = './test.jpg'; // 要上传的图片路径
//     const folderId = 'root'; // 上传到根目录，可以替换为其他文件夹ID
    
//     await uploadImageToAliyunDrive(filePath, folderId);
//     console.log('上传完成');
//   } catch (error) {
//     console.error('上传过程中出错:', error);
//   }
// })();

}
module.exports = new AliyunPanService();