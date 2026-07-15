export const environment = {
  production: false,

  // CUTOVER: apiUrl now points at the backend LLM proxy (BFF), not the
  // llama-server directly. The proxy holds the LLM key, injects the system
  // prompt, enforces guardrails + rate limits, and audits. Requires the backend
  // (port 8083) to be running the proxy code with the real env vars set
  // (LLM_BASE_URL=http://192.168.14.75:8080, LLM_API_KEY, AUDIT_ENCRYPTION_KEY).
  // To roll back to direct llama-server: apiUrl='http://192.168.14.75:8080' and
  // llmApiKey='mylocalminimax123'.
  apiUrl: 'http://localhost:8083',
  backend: 'http://localhost:8083',

  // Empty on purpose: the LLM key must NOT ship to the browser. The proxy injects
  // it server-side. buildHeaders() omits x-api-key entirely when this is ''.
  llmApiKey: '',

  // Google reCAPTCHA v2 site key. The value below is Google's official TEST key
  // (it always passes and shows a "for testing only" notice) so login keeps
  // working out-of-the-box in dev. Replace with your real site key in prod, and
  // verify the returned token server-side using the matching SECRET key.
  recaptchaSiteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
};
