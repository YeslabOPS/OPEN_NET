import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 处理后端统一响应格式
apiClient.interceptors.response.use(
  (response) => {
    const data = response.data;
    // 如果是后端的统一响应格式 { success, data, error }
    if (data && typeof data === 'object' && 'success' in data) {
      if (!data.success) {
        const err: any = new Error(data.error || 'Request failed');
        err.details = data.details;
        return Promise.reject(err);
      }
      return data.data;
    }
    return data;
  },
  (error) => {
    // 处理响应中的 details 信息
    if (error.response?.data?.details) {
      error.details = error.response.data.details;
    }
    console.error('[API Error]', error.message);
    return Promise.reject(error);
  }
);

export default apiClient;
