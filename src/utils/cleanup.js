const fs = require('fs');
const path = require('path');

async function cleanupFiles(filePaths) {
    for (const filePath of filePaths) {
        if (!filePath) continue;
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            console.error(`Failed to delete file ${filePath}:`, err.message);
        }
    }
}

module.exports = { cleanupFiles };
