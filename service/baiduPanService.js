const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');

class BaiduPanService {
    constructor() {
        this.config = {
            clientId: 'YOUR_CLIENT_ID',
            clientSecret: 'YOUR_CLIENT_SECRET',
            accessToken: 'YOUR_ACCESS_TOKEN',
            refreshToken: 'YOUR_REFRESH_TOKEN',
            apiBaseUrl: 'https://pan.baidu.com/rest/2.0',
            redirectUri: 'YOUR_REDIRECT_URI',
            uploadDir: '/apps/拾光舱/' // 网盘上传目录
        };
    }

    /**
     * 获取指定目录下的文件列表
     * @param {string} dirPath 百度网盘目录路径，如 '/apps/your_app/images/'
     * @returns {Promise<Array>} 文件列表
     */
    async getFileList(dirPath) {
        try {
            const response = await axios.get(`${this.config.apiBaseUrl}/xpan/file`, {
                params: {
                    method: 'list',
                    access_token: this.config.accessToken,
                    dir: dirPath,
                    web: 1 // 获取缩略图信息
                }
            });

            if (response.data.errno === 0) {
                // 过滤出图片文件
                return response.data.list.filter(file =>
                    this.isImageFile(file.server_filename)
                );
            }
            throw new Error(response.data.errmsg || '获取文件列表失败');
        } catch (error) {
            console.error('获取文件列表出错:', error.message);
            if (error.response?.data?.errno === 111) { // token过期
                await this.refreshToken();
                return this.getFileList(dirPath);
            }
            throw error;
        }
    }

    /**
     * 下载文件到本地
     * @param {string} filePath 百度网盘文件路径
     * @param {string} localDir 本地保存目录
     * @param {function} onProgress 进度回调函数
     * @returns {Promise<string>} 本地文件路径
     */
    async downloadFile(filePath, localDir, onProgress = null) {
        try {
            // 确保本地目录存在
            await fse.ensureDir(localDir);

            // 获取下载链接
            const downloadUrl = `${this.config.apiBaseUrl}/pcs/file?method=download&access_token=${this.config.accessToken}&path=${encodeURIComponent(filePath)}`;

            // 设置本地保存路径
            const fileName = path.basename(filePath);
            const localPath = path.join(localDir, fileName);

            // 下载文件
            const response = await axios({
                method: 'get',
                url: downloadUrl,
                responseType: 'stream',
                onDownloadProgress: progressEvent => {
                    if (onProgress) {
                        const percent = Math.round(
                            (progressEvent.loaded * 100) / progressEvent.total
                        );
                        onProgress(percent);
                    }
                }
            });

            // 保存到本地文件
            const writer = fs.createWriteStream(localPath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(localPath));
                writer.on('error', reject);
            });
        } catch (error) {
            console.error('下载文件出错:', error.message);
            if (error.response?.data?.errno === 111) { // token过期
                await this.refreshToken();
                return this.downloadFile(filePath, localDir, onProgress);
            }
            throw error;
        }
    }

    /**
     * 刷新access_token
     */
    async refreshToken() {
        try {
            const response = await axios.get('https://openapi.baidu.com/oauth/2.0/token', {
                params: {
                    grant_type: 'refresh_token',
                    refresh_token: this.config.refreshToken,
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret
                }
            });

            this.config.accessToken = response.data.access_token;
            this.config.refreshToken = response.data.refresh_token;
            console.log('Access token刷新成功');
        } catch (error) {
            console.error('刷新token失败:', error.message);
            throw error;
        }
    }

    /**
     * 判断是否为图片文件
     */
    isImageFile(filename) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const ext = path.extname(filename).toLowerCase();
        return imageExtensions.includes(ext);
    }

    /**
   * 根据百度网盘文件路径获取缩略图URL
   * @param {string} filePath 百度网盘文件路径
   * @param {object} options 缩略图选项
   * @param {number} options.width 缩略图宽度
   * @param {number} options.height 缩略图高度
   * @param {number} options.quality 缩略图质量(1-100)
   * @returns {Promise<string>} 缩略图URL
   */
    async getThumbnailUrl(filePath, options = {}) {
        const { width = 200, height = 200, quality = 80 } = options;

        try {
            const response = await axios.get(`${this.config.apiBaseUrl}/xpan/file`, {
                params: {
                    method: 'generate',
                    access_token: this.config.accessToken,
                    path: filePath,
                    thumb: 1, // 请求缩略图
                    width,
                    height,
                    quality
                }
            });

            if (response.data.errno === 0 && response.data.thumbs) {
                return response.data.thumbs.url1; // 返回缩略图URL
            }
            throw new Error(response.data.errmsg || '获取缩略图URL失败');
        } catch (error) {
            console.error('获取缩略图URL出错:', error.message);
            throw error;
        }
    }
    
    //从百度网盘获取图片并下载
    async downloadImagesFromBaiduPan(dirPath) {
        try {
            // 1. 获取指定目录下的图片列表
            console.log('正在获取文件列表...');
            const files = await getFileList(dirPath);

            console.log(`找到 ${files.length} 个图片文件:`);
            files.forEach((file, index) => {
                console.log(`${index + 1}. ${file.server_filename} (${formatFileSize(file.size)})`);
            });

            // 2. 下载图片到本地
            const localDir = path.join(__dirname, 'downloads');
            console.log(`\n开始下载图片到: ${localDir}`);

            for (const file of files) {
                const filePath = path.join(dirPath, file.server_filename);
                console.log(`\n下载: ${file.server_filename}`);

                await downloadFile(filePath, localDir, (percent) => {
                    process.stdout.write(`进度: ${percent}%\r`);
                });

                console.log(`\n下载完成: ${file.server_filename}`);
            }

            console.log('\n所有图片下载完成！');
        } catch (error) {
            console.error('操作失败:', error.message);
        }
    }

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
}
module.exports = new BaiduPanService();