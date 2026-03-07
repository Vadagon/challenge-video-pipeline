/**
 * Executes a function and retries it upon failure with predefined delays.
 * @param {Function} fn - The asynchronous function to execute.
 * @param {number[]} retries - Array of delays in milliseconds before each retry.
 * @returns The result of the function execution.
 */
async function withRetry(fn, retries = [10000, 30000, 60000, 90000, 120000]) {
    try {
        return await fn();
    } catch (error) {
        let statusCode = error.status || error.response?.status || 0;
        let errorMessage = error.message;
        let detailedError = "";

        if (error.response && error.response.data) {
            detailedError = JSON.stringify(error.response.data);
        } else if (error.body) {
            // Replicate SDK often puts the response body in error.body
            detailedError = typeof error.body === 'string' ? error.body : JSON.stringify(error.body);
        }

        if (statusCode === 429) {
            console.warn(`\n⚠️  Rate Limit (429) hit. Replicate is busy.`);
        }

        if (retries.length === 0) {
            if (detailedError) console.error(`❌ Final attempt failed: ${detailedError}`);
            throw error;
        }

        const delay = retries[0];
        console.warn(`⏳ API Request failed (Status: ${statusCode || 'Unknown'} - ${errorMessage})`);
        if (detailedError && detailedError !== "{}" && !errorMessage.includes(detailedError)) {
            console.warn(`   -> Details: ${detailedError}`);
        }
        console.warn(`   -> Retrying in ${delay / 1000} seconds... (${retries.length} attempts left)`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return withRetry(fn, retries.slice(1));
    }
}

module.exports = { withRetry };
