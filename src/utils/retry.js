/**
 * Executes a function and retries it upon failure with predefined delays.
 * @param {Function} fn - The asynchronous function to execute.
 * @param {number[]} retries - Array of delays in milliseconds before each retry.
 * @returns The result of the function execution.
 */
async function withRetry(fn, retries = [10000, 30000]) {
    try {
        return await fn();
    } catch (error) {
        let errorMessage = error.message;
        let detailedError = "";

        if (error.response && error.response.data) {
            detailedError = JSON.stringify(error.response.data);
            errorMessage = `Status ${error.response.status}: ${detailedError}`;
        }

        if (retries.length === 0) {
            if (detailedError) console.error(`❌ Final attempt failed: ${detailedError}`);
            throw error;
        }

        const delay = retries[0];
        console.warn(`⏳ API Request failed (${error.status || error.response?.status || error.message})`);
        if (detailedError) console.warn(`   -> Details: ${detailedError}`);
        console.warn(`   -> Retrying in ${delay / 1000} seconds...`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return withRetry(fn, retries.slice(1));
    }
}

module.exports = { withRetry };
