/**
 * Base Build "Verify & Add" looks for this meta tag in the initial HTML <head>.
 * Using app/head.tsx ensures it is rendered into <head> for the App Router.
 */

export default function Head() {
  // NOTE: Base app_id is not secret. Keeping a fallback avoids "Verify & Add" failures
  // when the env var is missing at build time (e.g., env added in Vercel after a deployment).
  const appId = (process.env.NEXT_PUBLIC_BASE_APP_ID || "696f2cefc0ab25addaaaf751").trim();
  return (
    <>
      <meta name="base:app_id" content={appId} />
    </>
  );
}
