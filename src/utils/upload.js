const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

/**
 * Uploads a local file to tmpfiles.org and returns a direct-download URL.
 * This is needed because Telegram file URLs have incorrect content-type
 * headers that third-party APIs (Replicate, etc.) cannot process.
 */
async function uploadToPublicUrl(filePath) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    const res = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: form.getHeaders(),
    });

    const pageUrl = res.data.data.url;
    // Convert page URL to direct download URL
    const directUrl = pageUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    return directUrl;
}

module.exports = { uploadToPublicUrl };
