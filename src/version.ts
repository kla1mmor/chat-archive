/** CI build number of this web bundle (0 for local builds). */
export const BUILD: number = __BUILD__;

/** Repository the apps update from. */
export const REPO = 'kla1mmor/chat-archive';
export const RELEASE_PAGE = `https://github.com/${REPO}/releases/tag/latest`;
export const UPDATE_BASE = `https://github.com/${REPO}/releases/download/latest/`;

export { REQUIRED_PLUGINS } from './version-plugins';
