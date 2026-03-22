import type { Metadata } from "next";

import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";



export const metadata: Metadata = {
  title: "MeetUp | Anonymous Video Chat",
  description: "Random video or Voice Chat with Random People",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    
      <html lang="en">
        <body>
          <ClerkProvider>
          {children}
          </ClerkProvider>
        </body>
      </html>
    
  );
}
