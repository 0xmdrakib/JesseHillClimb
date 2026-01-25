/**
 * Base Build "Verify & Add" looks for this meta tag in the initial HTML <head>.
 * Using app/head.tsx ensures it is rendered into <head> for the App Router.
 */

export default function Head() {
  const appId = process.env.NEXT_PUBLIC_BASE_APP_ID || "";
  return (
    <>
      {appId ? <meta name="base:app_id" content={appId} /> : null}
    </>
  );
}
