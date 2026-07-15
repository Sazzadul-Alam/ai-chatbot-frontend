export const environment = {
  production: true,
  apiUrl: '/isage-backend',

  // TODO: set the production URL/path of the APPLICATION backend (auth,
  // registration, conversation persistence, country codes). This was missing
  // before, which left every `environment.backend` call undefined in prod.
  // Point this at your reverse-proxy path for the app backend.
  backend: '/isage-api',

  // In production the LLM key must live on the backend proxy, NOT in the
  // browser bundle. Leave this empty and route inference through your backend.
  llmApiKey: '',

  // Set your PRODUCTION reCAPTCHA v2 site key here (and verify tokens with the
  // secret key server-side).
  recaptchaSiteKey: '',
};
