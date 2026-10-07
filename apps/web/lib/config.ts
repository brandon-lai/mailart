export const SITE_NAME = process.env.SITE_NAME || "Mailart";
export const SITE_URL = (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3335")).replace(/\/$/, "");
/** Library images, absolute, for anything that leaves the site (emails, og:image). */
export const PUBLIC_ASSET_BASE = (process.env.PUBLIC_ASSET_BASE_URL || `${SITE_URL}/lib/`).replace(/\/?$/, "/");
export const devGalleryEnabled = () => process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_GALLERY === "1";
