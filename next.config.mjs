/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Firebase profile picture domain for Google sign-in avatars.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "cdn.wdgtsrc.com" },
    ],
  },
};

export default nextConfig;
