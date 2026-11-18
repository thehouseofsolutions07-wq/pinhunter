/**
 * AI providers. Every "openai" style provider speaks the OpenAI /chat/completions format,
 * so adding a new one is usually just a base URL.
 */
export const PROVIDERS = {
  openai: { style: 'openai', baseUrl: 'https://api.openai.com/v1' },
  gemini: { style: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  grok: { style: 'openai', baseUrl: 'https://api.x.ai/v1' },
  xai: { style: 'openai', baseUrl: 'https://api.x.ai/v1' },
  groq: { style: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  openrouter: { style: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  deepseek: { style: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  mistral: { style: 'openai', baseUrl: 'https://api.mistral.ai/v1' },
  ollama: { style: 'openai', baseUrl: 'http://localhost:11434/v1', noKey: true },
  lmstudio: { style: 'openai', baseUrl: 'http://localhost:1234/v1', noKey: true },
  custom: { style: 'openai', baseUrl: '' },
  anthropic: { style: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  claude: { style: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  mock: { style: 'mock', baseUrl: '', noKey: true },
};
