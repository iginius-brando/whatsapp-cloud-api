import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "WhatsApp Cloud Chat",
  description: "Interfaccia di chat basata sulle WhatsApp Cloud API",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body className="antialiased text-gray-900">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
