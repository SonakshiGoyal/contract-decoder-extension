// Google AI API utilities
const API_KEY = (window.__contractDecoder_config && window.__contractDecoder_config.API_KEY) || '';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

function _extractTextFromResponse(data) {
  try {
    if (!data) return '';
    // common shapes
    if (data.candidates && data.candidates[0]) {
      const c = data.candidates[0];
      // candidate.content -> array of content blocks
      if (c.content) {
        if (Array.isArray(c.content)) {
          for (const item of c.content) {
            if (item.parts && item.parts[0] && item.parts[0].text) return item.parts[0].text;
            if (item.text) return item.text;
          }
        } else if (c.content.parts && c.content.parts[0] && c.content.parts[0].text) {
          return c.content.parts[0].text;
        }
      }
      // older shapes
      if (c.output && c.output[0] && c.output[0].content && c.output[0].content[0] && c.output[0].content[0].text) return c.output[0].content[0].text;
    }
    if (data.output && data.output[0] && data.output[0].content && data.output[0].content[0] && data.output[0].content[0].text) return data.output[0].content[0].text;
    if (typeof data.text === 'string') return data.text;
    // fallback to stringifying small responses
    const s = JSON.stringify(data);
    return s.length > 1000 ? s.slice(0,1000) + '...' : s;
  } catch (e) {
    return '';
  }
}

// Expose under a namespaced global to avoid colliding with page scripts
window.__contractDecoder_googleAI = {
  generateText: async function(prompt) {
    if (!API_KEY) throw new Error('Missing API key (window.__contractDecoder_config.API_KEY)');
    try {
      const response = await fetch(`${API_URL}?key=${API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Use a simple request shape expected by the Generative Language REST API
          prompt: {
            text: prompt
          }
        })
      });

      const data = await response.json();
      // Log raw response to console only in dev - helpful if parsing fails
      // console.debug('googleAI raw response', data);
      const text = _extractTextFromResponse(data);
      return text || '';
    } catch (error) {
      console.error('Error generating text:', error);
      throw error;
    }
  },

  summarizeText: async function(text) {
    try {
      const prompt = `Please provide a concise summary of the following text:\n\n${text}`;
      return await this.generateText(prompt);
    } catch (error) {
      console.error('Error summarizing text:', error);
      throw error;
    }
  },

  translateText: async function(text, targetLanguage) {
    try {
      const prompt = `Translate the following text to ${targetLanguage}:\n\n${text}`;
      return await this.generateText(prompt);
    } catch (error) {
      console.error('Error translating text:', error);
      throw error;
    }
  }
};