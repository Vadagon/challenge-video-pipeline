const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

function getApiBase() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    return `https://api.telegram.org/bot${token}`;
}

async function sendMessage(chatId, text) {
    try {
        await axios.post(`${getApiBase()}/sendMessage`, { chat_id: chatId, text });
    } catch (error) {
        console.error('Failed to send message:', error.response?.data || error.message);
    }
}

async function getFileUrl(fileId) {
    try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const resp = await axios.get(`${getApiBase()}/getFile?file_id=${fileId}`);
        if (!resp.data || !resp.data.ok || !resp.data.result) {
            throw new Error(`Telegram API Error: ${JSON.stringify(resp.data)}`);
        }
        const filePath = resp.data.result.file_path;
        return `https://api.telegram.org/file/bot${token}/${filePath}`;
    } catch (error) {
        console.error('Failed to get file URL:', error.response?.data || error.message);
        throw error;
    }
}

async function sendVideo(chatId, videoPath, caption) {
    try {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('video', fs.createReadStream(videoPath));
        if (caption) {
            form.append('caption', caption);
        }
        await axios.post(`${getApiBase()}/sendVideo`, form, {
            headers: form.getHeaders(),
            // Video uploads can take a while
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });
    } catch (error) {
        console.error('Failed to send video:', error.response?.data || error.message);
        throw error;
    }
}

let lastUpdateId = 0;

async function startPolling(onUpdate, pollInterval = 1000) {
    console.log("Started Telegram Bot polling...");

    const poll = async () => {
        try {
            const resp = await axios.get(`${getApiBase()}/getUpdates`, {
                params: {
                    offset: lastUpdateId + 1,
                    timeout: 30 // Long polling timeout
                }
            });

            if (resp.data && resp.data.ok && resp.data.result) {
                const updates = resp.data.result;
                for (const update of updates) {
                    if (update.update_id > lastUpdateId) {
                        lastUpdateId = update.update_id;
                    }
                    try {
                        await onUpdate(update);
                    } catch (err) {
                        console.error("Error processing update:", err);
                    }
                }
            }
        } catch (error) {
            console.error("Polling error:", error.message);
        }

        setTimeout(poll, pollInterval);
    };

    poll();
}

module.exports = { sendMessage, getFileUrl, sendVideo, startPolling };
