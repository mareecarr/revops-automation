// Minimal stand-in for axios so the HubSpot custom code actions can be run
// offline. The test installs handlers, the step under test calls get/post
// exactly as it would against Subskribe, and every call is recorded.
const state = {
  handlers: {},
  calls: []
};

const dispatch = async (method, url, data) => {
  state.calls.push({ method, url, data });
  const handler = state.handlers[method];
  if (!handler) throw new Error(`No stub handler registered for ${method.toUpperCase()} ${url}`);
  return handler(url, data);
};

module.exports = {
  __reset(handlers) {
    state.handlers = handlers || {};
    state.calls = [];
  },
  __calls() {
    return state.calls;
  },
  get: (url, config) => dispatch('get', url, config),
  post: (url, data) => dispatch('post', url, data),
  put: (url, data) => dispatch('put', url, data)
};
