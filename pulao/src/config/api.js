const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

export const API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000"
);

export const API_URL = `${API_BASE_URL}/api`;

export const VISION_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_VISION_BASE_URL || "http://localhost:6033"
);

export const VISION_HTTPS_PORT = Number(import.meta.env.VITE_VISION_HTTPS_PORT || 6443);

export const MOBILE_HOST =
  import.meta.env.VITE_MOBILE_HOST ||
  (typeof window !== "undefined" ? window.location.hostname : "localhost");

export const apiPath = (path = "") => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
};

export const visionPath = (path = "") => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${VISION_BASE_URL}${normalized}`;
};

export const visionBaseForCamera = (camera = {}) => {
  const configuredBase = trimTrailingSlash(import.meta.env.VITE_VISION_BASE_URL || "");
  if (configuredBase) return configuredBase;

  try {
    const url = new URL(VISION_BASE_URL);
    url.port = String(camera.stream_port || url.port || 6033);
    return trimTrailingSlash(url.toString());
  } catch {
    return VISION_BASE_URL;
  }
};
