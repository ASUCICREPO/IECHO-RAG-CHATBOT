export const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL!,
};

export const getApiEndpoint = (path: string = '') => {
  const baseUrl = config.apiUrl.endsWith('/') ? config.apiUrl.slice(0, -1) : config.apiUrl;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
};