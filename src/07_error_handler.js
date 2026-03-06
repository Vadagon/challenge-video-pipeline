// NODE: Error Handler
// Catches any pipeline error and sends a friendly message to the user

const TELEGRAM_BOT_TOKEN = "8754596174:AAHVBRlpbtevRd0Lo55dK1rlleIyXJ6bXfc";

// Try to extract chatId from the last known good data
const inputData = $input.first().json;
const chatId = inputData.chatId || null;

const errorMessage = $input.first().error?.message || "Unknown error";

if (chatId) {
  await this.helpers.httpRequest({
    method: "POST",
    url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    body: {
      chat_id: chatId,
      text: `❌ Something went wrong during video generation.\n\nError: ${errorMessage}\n\nPlease try again by sending your voice note first.`,
    },
    json: true,
  });
}

return [{ json: { handled: true, error: errorMessage } }];
