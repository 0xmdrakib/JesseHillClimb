export default function Head() {
  const appId = process.env.NEXT_PUBLIC_BASE_APP_ID || "696f2cefc0ab25addaaaf751";
  return (
    <>
      <meta name="base:app_id" content={appId} />
    </>
  );
}
