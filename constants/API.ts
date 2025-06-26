// API Configuration for Abracadabra Gesture Recognition
export const API_CONFIG = {
  BASE_URL: 'https://abracadabragestureprocessing-production.up.railway.app',
  ENDPOINTS: {
    PREDICT: '/api/predict',
    TRAIN: '/api/train',
    MODEL_STATUS: '/api/model-status',
    HEALTH: '/health'
  },
  TIMEOUT: 10000, // 10 seconds
};

// API Helper Functions
export const API_URLS = {
  predict: `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PREDICT}`,
  train: `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.TRAIN}`,
  modelStatus: `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.MODEL_STATUS}`,
  health: `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.HEALTH}`,
} as const;

export default API_CONFIG; 