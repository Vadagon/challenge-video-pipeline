const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function downloadFile(url, destPath) {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const writer = fs.createWriteStream(destPath);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        let error = null;
        writer.on('error', err => {
            error = err;
            writer.close();
            reject(err);
        });
        writer.on('close', () => {
            if (!error) resolve(destPath);
        });
    });
}

module.exports = { downloadFile };
