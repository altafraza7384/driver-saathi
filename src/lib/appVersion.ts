// Human-readable app version shown in More > About.
//
// About used to show only the build hash (e.g. "mvwo2mna"), which means
// nothing to a driver or to support. Bump APP_VERSION by hand for each
// release. It is kept here rather than read from package.json on purpose:
// package.json is a trigger path of android-play-release.yml, so bumping
// it on main also builds and uploads a new Play AAB.
export const APP_VERSION = "1.0.0";

/** "1.0.0 (build mvwo2mna)" — the build id still helps match a deploy. */
export function appVersionLabel(): string {
  const build = typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "";
  return build ? `${APP_VERSION} (build ${build})` : APP_VERSION;
}
