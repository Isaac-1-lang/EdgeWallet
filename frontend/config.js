// Configuration for different environments
const config = {
  // Automatically detect if running locally or on production
  getBackendUrl: function () {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

    // Local dev: serve backend directly on :8690
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '') {
      return `${protocol}//localhost:8690`;
    }

    // Production (VPS): backend API exposed on :9256 (as documented in README)
    return `${protocol}//${hostname}:9256`;
  }
};

// Export the backend URL
const BACKEND_URL = config.getBackendUrl();
