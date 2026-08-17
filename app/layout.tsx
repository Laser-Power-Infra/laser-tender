import type { Metadata } from "next";
import "./globals.css";
import { TabNav } from "@/components/TabNav";

export const metadata: Metadata = {
  title: "LaserPower Tender Dashboard",
  description: "Enquiry to Quotation Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <TabNav />
        <div
          style={{
            paddingTop: "42px",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </div>
      </body>
    </html>
  );
}
