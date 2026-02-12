// Configuration for different environments
const config = {
  // Automatically detect if running locally or on production
  getBackendUrl: function() {
    const hostname = window.location.hostname;
    
    // If running on localhost, use local backend
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:8256';
    }
    
    // If running on production VPS
    return 'http://157.173.101.159:8256';
  }
};

// Export the backend URL
const BACKEND_URL = config.getBackendUrl();
