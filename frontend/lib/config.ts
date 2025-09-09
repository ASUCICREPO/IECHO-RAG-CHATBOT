export const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_BASE_URL!,
};

if (!config.apiUrl) {
  console.warn('API URL not configured. Using relative paths.');
}

export const getApiEndpoint = (path: string = '') => {
  if (!config.apiUrl) {
    return path;
  }
  
  // Remove trailing slash from base URL
  const baseUrl = config.apiUrl.replace(/\/$/, '');
  
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  return `${baseUrl}${normalizedPath}`;
};