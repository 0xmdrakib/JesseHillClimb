export default function Head() {
  // Base "Verify & Add URL" looks for this meta tag in <head> on the homepage.
  // Keep it here (not in generateMetadata) so it is present immediately.
  return <meta name="base:app_id" content="696f2cefc0ab25addaaaf751" />;
}
